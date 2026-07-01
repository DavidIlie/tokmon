import { readFile, readdir, stat as fsStat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { resetIn } from '../../format'
import { readJson } from '../../http'
import type { Account, BillingResult, Metric } from '../types'
import { percentMetric } from '../_shared/metric'
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

function decodeBase64UrlJson(segment: string): any | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
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

function identityFromIdToken(idToken: unknown): Pick<CodexAuth, 'email' | 'displayName' | 'plan'> {
  if (typeof idToken !== 'string' || !idToken.includes('.')) return {}
  const payload = decodeBase64UrlJson(idToken.split('.')[1])
  if (!payload || typeof payload !== 'object') return {}
  const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : undefined
  const displayName = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim()
    : typeof payload.given_name === 'string' && payload.given_name.trim()
      ? payload.given_name.trim()
      : undefined
  const plan = chatGptPlanLabel(payload['https://api.openai.com/auth']?.chatgpt_plan_type)
  return { email, displayName, plan: plan ?? undefined }
}

function identityFields(auth: CodexAuth | null): Pick<BillingResult, 'email' | 'displayName'> {
  return {
    email: auth?.email ?? null,
    displayName: auth?.displayName ?? null,
  }
}

async function readAuthFile(home: string): Promise<CodexAuth | null> {
  try {
    const raw = await readFile(join(home, 'auth.json'), 'utf-8')
    const auth = JSON.parse(raw)
    const accessToken = auth?.tokens?.access_token
    if (!accessToken) return null
    return { accessToken, accountId: auth?.tokens?.account_id, ...identityFromIdToken(auth?.tokens?.id_token) }
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
    return { accessToken, accountId: auth?.tokens?.account_id, ...identityFromIdToken(auth?.tokens?.id_token) }
  } catch {
    return null
  }
}

async function getAuth(homeDir?: string): Promise<CodexAuth | null> {
  for (const home of codexHomes(homeDir)) {
    const auth = await readAuthFile(home)
    if (auth) return auth
  }
  if (process.platform === 'darwin') return readKeychainAuth()
  return null
}

function planLabel(planType: unknown): string | null {
  if (typeof planType !== 'string' || !planType.trim()) return null
  const p = planType.trim().toLowerCase()
  if (p === 'prolite') return 'Pro 5x'
  if (p === 'pro') return 'Pro 20x'
  return planType.charAt(0).toUpperCase() + planType.slice(1)
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
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

function normalizedUsedPercent(window: any, percent: unknown): number | undefined {
  const used = numberValue(percent)
  if (used === undefined) return undefined
  const periodSeconds = numberValue(window?.limit_window_seconds ?? window?.period_seconds ?? window?.window_seconds)
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
  const seconds = numberValue(window?.limit_window_seconds ?? window?.period_seconds ?? window?.window_seconds)
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
    metrics.push({ label: 'Credits', used: Math.floor(balance) * CREDIT_USD_RATE, limit: null, format: { kind: 'dollars' } })
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

    const resetCredits = await fetchResetCredits(headers)
      ?? numberValue(data?.rate_limit_reset_credits?.available_count ?? data?.rate_limit_reset_credits?.available)
    if (resetCredits !== undefined && resetCredits >= 0) {
      metrics.push({ label: 'Rate Limit Resets', used: resetCredits, limit: null, format: { kind: 'count', suffix: 'available' } })
    }

    if (metrics.length === 0) return null
    return { plan: auth.plan ?? planLabel(data.plan_type), metrics, error: null, ...identityFields(auth) }
  } catch {
    return null
  }
}

async function newestRolloutFile(homeDir?: string): Promise<string | null> {
  let best: { path: string; mtime: number } | null = null
  for (const home of codexHomes(homeDir)) {
    const dir = join(home, 'sessions')
    let listing: string[]
    try { listing = await readdir(dir, { recursive: true }) } catch { continue }
    for (const f of listing) {
      if (!f.endsWith('.jsonl') || !f.includes('rollout-')) continue
      const path = join(dir, f)
      try {
        const s = await fsStat(path)
        if (!best || s.mtimeMs > best.mtime) best = { path, mtime: s.mtimeMs }
      } catch {}
    }
  }
  return best?.path ?? null
}

async function snapshotBilling(homeDir?: string, auth: CodexAuth | null = null): Promise<BillingResult | null> {
  const path = await newestRolloutFile(homeDir)
  if (!path) return null
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
  if (!last) return null

  const metrics: Metric[] = []
  appendWindowMetrics(metrics, last.rate_limit ?? last)
  appendCredits(metrics, last)
  const resetCredits = numberValue(last?.rate_limit_reset_credits?.available_count ?? last?.rate_limit_reset_credits?.available)
  if (resetCredits !== undefined && resetCredits >= 0) {
    metrics.push({ label: 'Rate Limit Resets', used: resetCredits, limit: null, format: { kind: 'count', suffix: 'available' } })
  }
  if (metrics.length === 0) return null
  return { plan: auth?.plan ?? planLabel(last.plan_type), metrics, error: null, ...identityFields(auth) }
}

export async function codexBilling(account: Account): Promise<BillingResult> {
  const auth = await getAuth(account.homeDir)
  if (auth) {
    const live = await liveBilling(auth)
    if (live) return live
  }
  const snap = await snapshotBilling(account.homeDir, auth)
  if (snap) return snap
  return {
    plan: auth?.plan ?? null,
    metrics: [],
    error: auth ? 'Usage API failed — run codex to refresh' : 'Not logged in — run codex',
    ...identityFields(auth),
  }
}
