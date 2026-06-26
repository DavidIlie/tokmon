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

function resetFrom(window: any): string | null {
  if (!window) return null
  let iso: string | null = null
  if (typeof window.reset_at === 'number') iso = msToIso(window.reset_at * 1000)
  else if (typeof window.resets_at === 'number') iso = msToIso(window.resets_at * 1000)
  else if (typeof window.reset_after_seconds === 'number') iso = msToIso(Date.now() + window.reset_after_seconds * 1000)
  return iso ? resetIn(iso) : null
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

    const metrics: Metric[] = []
    const rl = data.rate_limit ?? null
    const primary = rl?.primary_window ?? null
    const secondary = rl?.secondary_window ?? null

    const headerPct = (name: string): number | undefined => {
      const h = res.headers.get(name)
      if (h === null || h.trim() === '') return undefined
      const n = Number(h)
      return Number.isFinite(n) ? n : undefined
    }
    const primaryPct = headerPct('x-codex-primary-used-percent') ?? primary?.used_percent
    const secondaryPct = headerPct('x-codex-secondary-used-percent') ?? secondary?.used_percent

    if (typeof primaryPct === 'number' && Number.isFinite(primaryPct)) metrics.push(percentMetric('5h', primaryPct, resetFrom(primary), true))
    if (typeof secondaryPct === 'number' && Number.isFinite(secondaryPct)) metrics.push(percentMetric('Week', secondaryPct, resetFrom(secondary)))

    const balance = data?.credits?.balance
    if (typeof balance === 'number' && Number.isFinite(balance) && balance >= 0) {
      metrics.push({ label: 'Credits', used: balance * CREDIT_USD_RATE, limit: null, format: { kind: 'dollars' } })
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
  if (typeof last.primary?.used_percent === 'number' && Number.isFinite(last.primary.used_percent)) {
    metrics.push(percentMetric('5h', last.primary.used_percent, resetFrom(last.primary), true))
  }
  if (typeof last.secondary?.used_percent === 'number' && Number.isFinite(last.secondary.used_percent)) {
    metrics.push(percentMetric('Week', last.secondary.used_percent, resetFrom(last.secondary)))
  }
  const balance = last?.credits?.balance
  if (typeof balance === 'number' && Number.isFinite(balance) && balance >= 0) {
    metrics.push({ label: 'Credits', used: balance * CREDIT_USD_RATE, limit: null, format: { kind: 'dollars' } })
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
