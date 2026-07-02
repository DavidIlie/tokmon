import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resetIn } from '../../format'
import { readJson } from '../../http'
import { expandHome } from '../../config'
import type { Account, BillingResult, Metric } from '../types'
import { identityFields } from '../_shared/identity'
import { finite, numberValue, percentMetric } from '../_shared/metric'
import { readMacKeychainRaw } from '../_shared/keychain'
import { readClaudeIdentity } from './identity'
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
  expiresAt?: number
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
      expiresAt: typeof o.expiresAt === 'number' && Number.isFinite(o.expiresAt) ? o.expiresAt : undefined,
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

interface AuthCandidate {
  auth: ClaudeAuth
  // The keychain item is a single machine-wide slot shared by every Claude Code
  // instance, so a keychain token may belong to a different account than the
  // one being polled; file creds live inside the account's own home dir.
  shared: boolean
}

async function authCandidates(homeDir?: string): Promise<AuthCandidate[]> {
  const expandedHomeDir = homeDir ? expandHome(homeDir) : undefined
  const isDefault = !expandedHomeDir || expandedHomeDir === homedir()
  const out: AuthCandidate[] = []
  const file = await readCredentialsFile(isDefault ? undefined : expandedHomeDir)
  const keychain = process.platform === 'darwin' ? await readMacKeychain() : null
  // Default account: keychain first (Claude Code keeps it fresher than the file); alt accounts: own file first.
  const ordered = isDefault
    ? [keychain && { auth: keychain, shared: true }, file && { auth: file, shared: false }]
    : [file && { auth: file, shared: false }, keychain && { auth: keychain, shared: true }]
  for (const c of ordered) if (c) out.push(c)
  return out
}

interface TokenIdentity {
  accountUuid: string
  email: string | null
}

// A token's binding to its account never changes, so cache verdicts for the process lifetime.
const tokenIdentityCache = new Map<string, TokenIdentity | null>()

async function tokenIdentity(token: string): Promise<TokenIdentity | null | undefined> {
  if (tokenIdentityCache.has(token)) return tokenIdentityCache.get(token)
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/profile', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'tokmon',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (res.status === 401 || res.status === 403) {
      tokenIdentityCache.set(token, null)
      return null
    }
    if (!res.ok) return undefined // transient — do not cache
    const data = await readJson<{ account?: { uuid?: unknown; email?: unknown } }>(res)
    const uuid = data?.account?.uuid
    if (typeof uuid !== 'string' || !uuid) return undefined
    const identity: TokenIdentity = {
      accountUuid: uuid,
      email: typeof data?.account?.email === 'string' ? data.account.email : null,
    }
    if (tokenIdentityCache.size > 64) tokenIdentityCache.clear()
    tokenIdentityCache.set(token, identity)
    return identity
  } catch {
    return undefined // transient — do not cache
  }
}

interface ResolvedAuth {
  auth: ClaudeAuth | null
  // Set when every available credential belongs to a different account than this one.
  wrongAccountEmail?: string | null
  expired?: boolean
}

async function getAuth(homeDir: string | undefined, expectedUuid: string | undefined): Promise<ResolvedAuth> {
  const candidates = await authCandidates(homeDir)
  let wrongAccountEmail: string | null | undefined
  let sawExpired = false
  for (const { auth, shared } of candidates) {
    if (auth.expiresAt !== undefined && auth.expiresAt < Date.now() - 60_000) { sawExpired = true; continue }
    // Account-scoped file creds are trusted as-is; the shared keychain slot must
    // prove it holds THIS account's token before we attribute its data here.
    if (!shared || !expectedUuid) return { auth }
    const identity = await tokenIdentity(auth.token)
    if (identity === undefined) return { auth } // verification unavailable — keep old behavior
    if (identity === null) continue // dead token
    if (identity.accountUuid === expectedUuid) return { auth }
    wrongAccountEmail = identity.email
  }
  if (wrongAccountEmail !== undefined) return { auth: null, wrongAccountEmail }
  return { auth: null, expired: sawExpired }
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
  const identity = readClaudeIdentity(account.homeDir)
  const { auth, wrongAccountEmail, expired } = await getAuth(account.homeDir, identity.accountUuid)
  if (!auth) {
    const error = wrongAccountEmail !== undefined
      ? `Signed in as ${wrongAccountEmail ?? 'another account'} — run claude in this home to refresh`
      : expired
        ? 'Token expired — run claude to refresh'
        : 'No OAuth token — run claude and log in'
    return { plan: identity.plan ?? null, metrics: [], error, ...identityFields(identity) }
  }
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
    if (res.status === 401) return { plan, metrics: [], error: 'Token expired — run claude to refresh', ...identityFields(identity) }
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
