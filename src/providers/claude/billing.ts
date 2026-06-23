import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resetIn } from '../../format'
import { readJson } from '../../http'
import { expandHome } from '../../config'
import type { Account, BillingResult, Metric } from '../types'
import { finite, percentMetric } from '../_shared/metric'
import { readMacKeychainRaw } from '../_shared/keychain'
import { claudeConfigDirs } from './usage'

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

interface ClaudeIdentity {
  email?: string
  displayName?: string
  plan?: string
}

function titleWords(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function claudeOrgPlanLabel(orgType: unknown): string | null {
  if (typeof orgType !== 'string' || !orgType.trim()) return null
  const normalized = orgType.trim().toLowerCase()
  const stripped = normalized.startsWith('claude_') ? normalized.slice('claude_'.length) : normalized
  const label = titleWords(stripped)
  return label ? `Claude ${label}` : null
}

async function readClaudeIdentity(homeDir?: string): Promise<ClaudeIdentity> {
  const base = homeDir ? expandHome(homeDir) : homedir()
  try {
    const parsed = JSON.parse(await readFile(join(base, '.claude.json'), 'utf-8'))
    const oauth = parsed?.oauthAccount
    const email = typeof oauth?.emailAddress === 'string' && oauth.emailAddress.trim()
      ? oauth.emailAddress.trim()
      : undefined
    const displayName = typeof oauth?.displayName === 'string' && oauth.displayName.trim()
      ? oauth.displayName.trim()
      : undefined
    const plan = claudeOrgPlanLabel(parsed?.organizationType)
    return { email, displayName, plan: plan ?? undefined }
  } catch {
    return {}
  }
}

function identityFields(identity: ClaudeIdentity): Pick<BillingResult, 'email' | 'displayName'> {
  return {
    email: identity.email ?? null,
    displayName: identity.displayName ?? null,
  }
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
  const raw = await readMacKeychainRaw('Claude Code-credentials')
  return raw ? parseAuth(raw) : null
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

const pct = (used: number, resets?: string | null, primary?: boolean): Metric =>
  percentMetric('', used, resets ?? null, primary)

function usageMetric(label: string, window: { utilization?: unknown; resets_at?: unknown } | null | undefined, primary?: boolean): Metric | null {
  if (!window || typeof window.utilization !== 'number' || !Number.isFinite(window.utilization)) return null
  const resets = typeof window.resets_at === 'string' && window.resets_at.trim()
    ? resetIn(window.resets_at)
    : null
  return { ...pct(window.utilization, resets, primary), label }
}

export async function claudeBilling(account: Account): Promise<BillingResult> {
  const [auth, identity] = await Promise.all([
    getAuth(account.homeDir),
    readClaudeIdentity(account.homeDir),
  ])
  if (!auth) return { plan: identity.plan ?? null, metrics: [], error: 'No OAuth token — run claude and log in', ...identityFields(identity) }
  const plan = identity.plan ?? planLabel(auth)

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${auth.token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'tokmon',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (res.status === 429) return { plan, metrics: [], error: 'Rate limited — retrying next poll', ...identityFields(identity) }
    if (res.status === 401) return { plan, metrics: [], error: 'Token expired — restart Claude Code', ...identityFields(identity) }
    if (!res.ok) return { plan, metrics: [], error: `API ${res.status}`, ...identityFields(identity) }

    const data = await readJson<OAuthResponse>(res)
    if (!data) return { plan, metrics: [], error: 'Unexpected API response', ...identityFields(identity) }
    const metrics: Metric[] = []

    const fiveHour = usageMetric('5h', data.five_hour, true)
    if (fiveHour) metrics.push(fiveHour)
    const sevenDay = usageMetric('Week', data.seven_day)
    if (sevenDay) metrics.push(sevenDay)
    const sevenDaySonnet = usageMetric('Sonnet', data.seven_day_sonnet)
    if (sevenDaySonnet) metrics.push(sevenDaySonnet)
    if (data.extra_usage?.is_enabled) {
      const monthlyLimit = data.extra_usage.monthly_limit
      metrics.push({
        label: 'Extra',
        used: finite(data.extra_usage.used_credits) / 100,
        limit: typeof monthlyLimit === 'number' && Number.isFinite(monthlyLimit) ? monthlyLimit / 100 : null,
        format: { kind: 'dollars', currency: data.extra_usage.currency ?? 'USD' },
      })
    }

    return { plan, metrics, error: null, ...identityFields(identity) }
  } catch {
    return { plan, metrics: [], error: 'Network error', ...identityFields(identity) }
  }
}
