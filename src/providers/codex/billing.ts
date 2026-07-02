import { readFile, readdir, stat as fsStat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { resetIn } from '../../format'
import { readJson } from '../../http'
import type { Account, BillingResult, Metric } from '../types'
import { identityFields } from '../_shared/identity'
import { identityFromIdToken } from '../_shared/jwt'
import { numberValue, percentMetric } from '../_shared/metric'
import { msToIso } from '../_shared/time'
import { readMacKeychainRaw } from '../_shared/keychain'
import { codexHomes } from './usage'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
const CREDIT_USD_RATE = 0.04

interface CodexAuth {
  accessToken: string
  accountId?: string
  email?: string
  displayName?: string
  plan?: string
}

function chatGptPlanLabel(planType: unknown): string | null {
  if (typeof planType !== 'string' || !planType.trim()) return null
  const p = planType.trim().toLowerCase()
  const labels: Record<string, string> = {
    free: 'ChatGPT Free',
    plus: 'ChatGPT Plus',
    pro: 'ChatGPT Pro',
    team: 'ChatGPT Team',
    enterprise: 'ChatGPT Enterprise',
    edu: 'ChatGPT Edu',
  }
  if (labels[p]) return labels[p]
  return `ChatGPT ${p.charAt(0).toUpperCase()}${p.slice(1)}`
}

function codexIdentity(idToken: unknown): Pick<CodexAuth, 'email' | 'displayName' | 'plan'> {
  const { email, displayName, payload } = identityFromIdToken(idToken)
  if (!payload) return {}
  const plan = chatGptPlanLabel(payload['https://api.openai.com/auth']?.chatgpt_plan_type)
  return { email, displayName, plan: plan ?? undefined }
}

async function readAuthFile(home: string): Promise<CodexAuth | null> {
  try {
    const raw = await readFile(join(home, 'auth.json'), 'utf-8')
    const auth = JSON.parse(raw)
    const accessToken = auth?.tokens?.access_token
    if (!accessToken) return null
    return { accessToken, accountId: auth?.tokens?.account_id, ...codexIdentity(auth?.tokens?.id_token) }
  } catch {
    return null
  }
}

async function readKeychainAuth(): Promise<CodexAuth | null> {
  try {
    const raw = await readMacKeychainRaw('Codex Auth')
    if (!raw) return null
    const auth = JSON.parse(raw)
    const accessToken = auth?.tokens?.access_token
    if (!accessToken) return null
    return { accessToken, accountId: auth?.tokens?.account_id, ...codexIdentity(auth?.tokens?.id_token) }
  } catch {
    return null
  }
}

async function getAuth(homeDir?: string): Promise<CodexAuth | null> {
  for (const home of codexHomes(homeDir)) {
    const auth = await readAuthFile(home)
    if (auth) return auth
  }
  // The keychain "Codex Auth" item is a single machine-wide slot that belongs to
  // the default account — never attribute it to a custom-home (alt) account.
  if (!homeDir && process.platform === 'darwin') return readKeychainAuth()
  return null
}

function planLabel(planType: unknown): string | null {
  if (typeof planType !== 'string' || !planType.trim()) return null
  const p = planType.trim().toLowerCase()
  if (p === 'prolite') return 'Pro 5x'
  if (p === 'pro') return 'Pro 20x'
  return planType.charAt(0).toUpperCase() + planType.slice(1)
}

function resetDateMs(window: any): number | null {
  if (!window) return null
  const absolute = numberValue(window.reset_at ?? window.resets_at)
  if (absolute !== undefined) return absolute > 10_000_000_000 ? absolute : absolute * 1000
  const after = numberValue(window.reset_after_seconds)
  if (after !== undefined) return Date.now() + after * 1000
  for (const key of ['reset_at', 'resets_at']) {
    const raw = window[key]
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = new Date(raw).getTime()
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function resetFrom(window: any): string | null {
  const ms = resetDateMs(window)
  const iso = ms === null ? null : msToIso(ms)
  return iso ? resetIn(iso) : null
}

function windowSeconds(window: any): number | undefined {
  const seconds = numberValue(window?.limit_window_seconds ?? window?.period_seconds ?? window?.window_seconds)
  if (seconds !== undefined) return seconds
  const minutes = numberValue(window?.limit_window_minutes ?? window?.window_minutes ?? window?.period_minutes)
  return minutes === undefined ? undefined : minutes * 60
}

function normalizedUsedPercent(window: any, percent: unknown): number | undefined {
  const used = numberValue(percent)
  if (used === undefined) return undefined
  const periodSeconds = windowSeconds(window)
  const resetMs = resetDateMs(window)
  if (periodSeconds && resetMs) {
    const elapsedMs = periodSeconds * 1000 - Math.max(0, resetMs - Date.now())
    if (elapsedMs <= 60_000 && used <= 1) return 0
  }
  return Math.max(0, used)
}

function metricLabelForAdditional(window: any): string | null {
  const name = String(window?.limit_name ?? window?.name ?? window?.metered_feature ?? window?.feature ?? '').toLowerCase()
  if (!name.includes('spark')) return null
  const seconds = windowSeconds(window)
  return name.includes('week') || (seconds !== undefined && seconds >= 6 * 24 * 60 * 60) ? 'Spark Weekly' : 'Spark'
}

function additionalRateLimits(rl: any): any[] {
  const raw = rl?.additional_rate_limits ?? rl?.additionalRateLimits ?? rl?.additional
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') return Object.values(raw)
  return []
}

function appendWindowMetrics(metrics: Metric[], rl: any, headerPct?: (name: string) => number | undefined): void {
  const primary = rl?.primary_window ?? rl?.primary ?? null
  const secondary = rl?.secondary_window ?? rl?.secondary ?? null
  const primaryPct = normalizedUsedPercent(primary, primary?.used_percent ?? primary?.percent_used ?? headerPct?.('x-codex-primary-used-percent'))
  const secondaryPct = normalizedUsedPercent(secondary, secondary?.used_percent ?? secondary?.percent_used ?? headerPct?.('x-codex-secondary-used-percent'))

  if (primaryPct !== undefined) metrics.push(percentMetric('Session', primaryPct, resetFrom(primary), true))
  if (secondaryPct !== undefined) metrics.push(percentMetric('Weekly', secondaryPct, resetFrom(secondary)))

  for (const item of additionalRateLimits(rl)) {
    const label = metricLabelForAdditional(item)
    if (!label) continue
    const used = normalizedUsedPercent(item, item?.used_percent ?? item?.percent_used)
    if (used === undefined) continue
    metrics.push(percentMetric(label, used, resetFrom(item)))
  }
}

function appendCredits(metrics: Metric[], source: any): void {
  const balance = numberValue(source?.credits?.balance ?? source?.credit_balance)
  if (balance !== undefined && balance >= 0) {
    metrics.push({ label: 'Credits', used: balance * CREDIT_USD_RATE, limit: null, format: { kind: 'dollars' } })
  }
}

async function fetchResetCredits(headers: Record<string, string>): Promise<number | undefined> {
  try {
    const res = await fetch(RESET_CREDITS_URL, {
      headers: {
        ...headers,
        'OpenAI-Beta': 'codex-1',
        'originator': 'Codex Desktop',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return undefined
    const data = await readJson<any>(res)
    return numberValue(data?.available_count ?? data?.available ?? data?.remaining)
  } catch {
    return undefined
  }
}

async function liveBilling(auth: CodexAuth): Promise<BillingResult | null> {
  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${auth.accessToken}`,
      'Accept': 'application/json',
      'User-Agent': 'tokmon',
    }
    if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId

    const res = await fetch(USAGE_URL, { headers, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const data = await readJson<any>(res)
    if (!data) return null

    const headerPct = (name: string): number | undefined => {
      const h = res.headers.get(name)
      if (h === null || h.trim() === '') return undefined
      const n = Number(h)
      return Number.isFinite(n) ? n : undefined
    }

    const metrics: Metric[] = []
    appendWindowMetrics(metrics, data.rate_limit ?? data, headerPct)
    appendCredits(metrics, data)

    // Prefer the value already in the usage response; only pay for a second round-trip when absent.
    const resetCredits = numberValue(data?.rate_limit_reset_credits?.available_count ?? data?.rate_limit_reset_credits?.available)
      ?? await fetchResetCredits(headers)
    if (resetCredits !== undefined && resetCredits >= 0) {
      metrics.push({ label: 'Resets', used: resetCredits, limit: null, format: { kind: 'count', suffix: 'available' } })
    }

    if (metrics.length === 0) return null
    return { plan: auth.plan ?? planLabel(data.plan_type), metrics, error: null, ...identityFields(auth) }
  } catch {
    return null
  }
}

const SNAPSHOT_CANDIDATES = 8
const SNAPSHOT_STALE_MS = 24 * 3_600_000

async function newestRolloutFiles(homeDir?: string): Promise<{ path: string; mtime: number }[]> {
  const all: { path: string; mtime: number }[] = []
  for (const home of codexHomes(homeDir)) {
    const dir = join(home, 'sessions')
    let listing: string[]
    try { listing = await readdir(dir, { recursive: true }) } catch { continue }
    for (const f of listing) {
      if (!f.endsWith('.jsonl') || !f.includes('rollout-')) continue
      const path = join(dir, f)
      try {
        const s = await fsStat(path)
        all.push({ path, mtime: s.mtimeMs })
      } catch {}
    }
  }
  return all.sort((a, b) => b.mtime - a.mtime).slice(0, SNAPSHOT_CANDIDATES)
}

async function lastRateLimits(path: string): Promise<any | null> {
  let last: any = null
  try {
    const input = createReadStream(path)
    input.on('error', () => {})
    const rl = createInterface({ input, crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.includes('rate_limits')) continue
      try {
        const obj = JSON.parse(line)
        if (obj?.payload?.rate_limits) last = obj.payload.rate_limits
      } catch {}
    }
  } catch {
    return null
  }
  return last
}

// A brand-new session file has no rate_limits yet, so walk newest-first until one does.
async function snapshotBilling(homeDir?: string, auth: CodexAuth | null = null): Promise<(BillingResult & { asOfMs: number }) | null> {
  for (const file of await newestRolloutFiles(homeDir)) {
    const last = await lastRateLimits(file.path)
    if (!last) continue

    const metrics: Metric[] = []
    appendWindowMetrics(metrics, last.rate_limit ?? last)
    appendCredits(metrics, last)
    const resetCredits = numberValue(last?.rate_limit_reset_credits?.available_count ?? last?.rate_limit_reset_credits?.available)
    if (resetCredits !== undefined && resetCredits >= 0) {
      metrics.push({ label: 'Resets', used: resetCredits, limit: null, format: { kind: 'count', suffix: 'available' } })
    }
    if (metrics.length === 0) continue
    return { plan: auth?.plan ?? planLabel(last.plan_type), metrics, error: null, asOfMs: file.mtime, ...identityFields(auth) }
  }
  return null
}

export async function codexBilling(account: Account): Promise<BillingResult> {
  const auth = await getAuth(account.homeDir)
  if (auth) {
    const live = await liveBilling(auth)
    if (live) return live
  }
  const snap = await snapshotBilling(account.homeDir, auth)
  // Serve offline snapshots while they're plausibly current; a day-old snapshot
  // behind a failing live API is misinformation, not data.
  if (snap && Date.now() - snap.asOfMs < SNAPSHOT_STALE_MS) {
    const { asOfMs: _asOfMs, ...result } = snap
    return result
  }
  return {
    plan: auth?.plan ?? snap?.plan ?? null,
    metrics: [],
    error: auth ? 'Usage API failed — run codex to refresh' : 'Not logged in — run codex',
    ...identityFields(auth),
  }
}
