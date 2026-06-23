import { execFile as execFileCb } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { resetIn } from '../../format'
import { readJson } from '../../http'
import { expandHome } from '../../config'
import type { Account, BillingResult, Metric } from '../types'
import { claudeConfigDirs } from './usage'

const execFile = promisify(execFileCb)

interface OAuthResponse {
  five_hour?: { utilization: number; resets_at: string }
  seven_day?: { utilization: number; resets_at: string }
  seven_day_sonnet?: { utilization: number; resets_at: string } | null
  extra_usage?: {
    is_enabled: boolean
    monthly_limit: number | null
    used_credits: number | null
    currency?: string | null
  } | null
}

interface ClaudeAuth {
  token: string
  subscriptionType?: string
  rateLimitTier?: string
}

function parseAuth(raw: string): ClaudeAuth | null {
  try {
    const creds = JSON.parse(raw)
    const o = creds?.claudeAiOauth ?? creds
    const token = o?.accessToken
    if (typeof token !== 'string' || !token) return null
    return {
      token,
      subscriptionType: typeof o.subscriptionType === 'string' ? o.subscriptionType : undefined,
      rateLimitTier: typeof o.rateLimitTier === 'string' ? o.rateLimitTier : undefined,
    }
  } catch {
    return null
  }
}

async function readCredentialsFile(homeDir?: string): Promise<ClaudeAuth | null> {
  for (const dir of claudeConfigDirs(homeDir)) {
    try {
      const auth = parseAuth(await readFile(join(dir, '.credentials.json'), 'utf-8'))
      if (auth) return auth
    } catch {}
  }
  return null
}

async function readMacKeychain(): Promise<ClaudeAuth | null> {
  try {
    const { stdout } = await execFile('security', [
      'find-generic-password', '-s', 'Claude Code-credentials', '-w',
    ], { timeout: 5000 })
    return parseAuth(stdout.trim())
  } catch {
    return null
  }
}

async function getAuth(homeDir?: string): Promise<ClaudeAuth | null> {
  const expandedHomeDir = homeDir ? expandHome(homeDir) : undefined
  const isDefault = !expandedHomeDir || expandedHomeDir === homedir()
  // macOS default account: keychain ("Claude Code-credentials") first; custom-homeDir accounts use .credentials.json first.
  if (isDefault) {
    if (process.platform === 'darwin') {
      const auth = await readMacKeychain()
      if (auth) return auth
    }
    return readCredentialsFile(undefined)
  }
  // Non-default: file first, but fall back to keychain — Claude Code sometimes stores creds only there even for custom dirs.
  const fileAuth = await readCredentialsFile(expandedHomeDir)
  if (fileAuth) return fileAuth
  if (process.platform === 'darwin') return readMacKeychain()
  return null
}

function planLabel(auth: ClaudeAuth): string | null {
  const sub = auth.subscriptionType
  if (!sub) return null
  const base = sub.charAt(0).toUpperCase() + sub.slice(1)
  const tier = (auth.rateLimitTier ?? '').match(/(\d+)x/)
  return tier ? `${base} ${tier[1]}x` : base
}

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const pct = (used: number, resets?: string | null, primary?: boolean): Metric => ({
  label: '',
  used: finite(used),
  limit: 100,
  format: { kind: 'percent' },
  resetsAt: resets ?? null,
  ...(primary === undefined ? {} : { primary }),
})

export async function claudeBilling(account: Account): Promise<BillingResult> {
  const auth = await getAuth(account.homeDir)
  if (!auth) return { plan: null, metrics: [], error: 'No OAuth token — run claude and log in' }
  const plan = planLabel(auth)

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'tokmon',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (res.status === 429) return { plan, metrics: [], error: 'Rate limited — retrying next poll' }
    if (res.status === 401) return { plan, metrics: [], error: 'Token expired — restart Claude Code' }
    if (!res.ok) return { plan, metrics: [], error: `API ${res.status}` }

    const data = await readJson<OAuthResponse>(res)
    if (!data) return { plan, metrics: [], error: 'Unexpected API response' }
    const metrics: Metric[] = []

    if (data.five_hour) {
      metrics.push({ ...pct(data.five_hour.utilization, resetIn(data.five_hour.resets_at), true), label: '5h' })
    }
    if (data.seven_day) {
      metrics.push({ ...pct(data.seven_day.utilization, resetIn(data.seven_day.resets_at)), label: 'Week' })
    }
    if (data.seven_day_sonnet) {
      metrics.push({ ...pct(data.seven_day_sonnet.utilization), label: 'Sonnet' })
    }
    if (data.extra_usage?.is_enabled) {
      const monthlyLimit = data.extra_usage.monthly_limit
      metrics.push({
        label: 'Extra',
        used: finite(data.extra_usage.used_credits) / 100,
        limit: typeof monthlyLimit === 'number' && Number.isFinite(monthlyLimit) ? monthlyLimit / 100 : null,
        format: { kind: 'dollars', currency: data.extra_usage.currency ?? 'USD' },
      })
    }

    return { plan, metrics, error: null }
  } catch {
    return { plan, metrics: [], error: 'Network error' }
  }
}
