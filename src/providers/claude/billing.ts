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
  five_hour?: { utilization?: unknown; resets_at?: unknown }
  seven_day?: { utilization?: unknown; resets_at?: unknown }
  seven_day_sonnet?: { utilization?: unknown; resets_at?: unknown } | null
  extra_usage?: {
    is_enabled?: unknown
    monthly_limit?: unknown
    used_credits?: unknown
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

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function boolValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true' || value.trim() === '1'
  return false
}

function resetFrom(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return resetIn(value)
  const n = numberValue(value)
  if (n === undefined) return null
  const ms = Math.abs(n) < 10_000_000_000 ? n * 1000 : n
  return resetIn(new Date(ms).toISOString())
}

function usageMetric(label: string, window: { utilization?: unknown; resets_at?: unknown } | null | undefined, primary?: boolean): Metric | null {
  const used = numberValue(window?.utilization)
  if (used === undefined) return null
  return { ...pct(used, resetFrom(window?.resets_at), primary), label }
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

    if (res.status === 429) {
      const retryAfter = numberValue(res.headers.get('retry-after'))
      const retryText = retryAfter !== undefined ? ` — retry in ~${Math.ceil(retryAfter / 60)}m` : ' — retrying next poll'
      return { plan, metrics: [], error: `Rate limited${retryText}`, ...identityFields(identity) }
    }
    if (res.status === 401) return { plan, metrics: [], error: 'Token expired — restart Claude Code', ...identityFields(identity) }
    if (!res.ok) return { plan, metrics: [], error: `API ${res.status}`, ...identityFields(identity) }

    const data = await readJson<OAuthResponse>(res)
    if (!data) return { plan, metrics: [], error: 'Unexpected API response', ...identityFields(identity) }
    const metrics: Metric[] = []

    const fiveHour = usageMetric('Session', data.five_hour, true)
    if (fiveHour) metrics.push(fiveHour)
    const sevenDay = usageMetric('Weekly', data.seven_day)
    if (sevenDay) metrics.push(sevenDay)
    const sevenDaySonnet = usageMetric('Sonnet', data.seven_day_sonnet)
    if (sevenDaySonnet) metrics.push(sevenDaySonnet)
    if (boolValue(data.extra_usage?.is_enabled)) {
      const usedCredits = numberValue(data.extra_usage?.used_credits)
      const monthlyLimit = numberValue(data.extra_usage?.monthly_limit)
      if (usedCredits !== undefined && (usedCredits > 0 || (monthlyLimit !== undefined && monthlyLimit > 0))) {
        metrics.push({
          label: 'Extra',
          used: finite(usedCredits) / 100,
          limit: monthlyLimit !== undefined && monthlyLimit > 0 ? monthlyLimit / 100 : null,
          format: { kind: 'dollars', currency: data.extra_usage?.currency ?? 'USD' },
        })
      }
    }

    return { plan, metrics, error: null, ...identityFields(identity) }
  } catch {
    return { plan, metrics: [], error: 'Network error', ...identityFields(identity) }
  }
}
