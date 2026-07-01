import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resetIn } from '../../format'
import { envDir } from '../../config'
import { readJson } from '../../http'
import type { Account, BillingResult, Metric } from '../types'
import { dollars, finite, finiteNumber, percentMetric } from '../_shared/metric'
import { msToIso } from '../_shared/time'
import { cursorActivity } from './activity'
import { cursorModelSpend } from './composer'
import { runSqlite, sqliteStatusMessage, type SqliteStatus } from './sqlite'

const BASE = 'https://api2.cursor.sh/aiserver.v1.DashboardService'
const USAGE_URL = `${BASE}/GetCurrentPeriodUsage`
const PLAN_URL = `${BASE}/GetPlanInfo`
const CREDITS_URL = `${BASE}/GetCreditGrantsBalance`
const STRIPE_URL = 'https://cursor.com/api/auth/stripe'

interface PlanUsage {
  remaining?: number
  limit?: number
  totalSpend?: number
  totalPercentUsed?: number
  autoPercentUsed?: number
  apiPercentUsed?: number
}
interface SpendLimitUsage {
  limitType?: string
  individualLimit?: number
  individualRemaining?: number
  individualUsed?: number
  pooledLimit?: number
  pooledRemaining?: number
  pooledUsed?: number
  totalSpend?: number
}
interface UsageResponse {
  billingCycleStart?: string
  billingCycleEnd?: string
  planUsage?: PlanUsage
  spendLimitUsage?: SpendLimitUsage
  enabled?: boolean
}

interface CreditGrantsResponse {
  hasCreditGrants?: boolean
  totalCents?: number
  usedCents?: number
}

export function cursorStateDb(homeDir?: string): string {
  const base = homeDir ?? homedir()
  const tail = ['Cursor', 'User', 'globalStorage', 'state.vscdb']
  if (process.platform === 'darwin') {
    return join(base, 'Library', 'Application Support', ...tail)
  }
  if (process.platform === 'win32') {
    const roaming = homeDir ? join(homeDir, 'AppData', 'Roaming') : (envDir('APPDATA') ?? join(base, 'AppData', 'Roaming'))
    return join(roaming, ...tail)
  }
  const cfg = homeDir ? join(homeDir, '.config') : (envDir('XDG_CONFIG_HOME') ?? join(base, '.config'))
  return join(cfg, ...tail)
}

export async function detectCursor(homeDir?: string): Promise<boolean> {
  try { await access(cursorStateDb(homeDir)); return true } catch { return false }
}

async function readState(db: string, key: string): Promise<{ value: string | null; status: SqliteStatus }> {
  const r = await runSqlite(db, 'SELECT value FROM ItemTable WHERE key=? LIMIT 1;', [key])
  const raw = r.status === 'ok' ? r.rows[0]?.value : undefined
  return { value: typeof raw === 'string' && raw.trim() ? raw.trim() : null, status: r.status }
}

function cleanStoredString(value: string | null): string | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim()
  } catch {
  }
  const trimmed = value.trim().replace(/^"|"$/g, '')
  return trimmed || undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
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

function cursorSessionToken(accessToken: string): string | null {
  const payload = accessToken.includes('.') ? decodeBase64UrlJson(accessToken.split('.')[1]) : null
  const subject = typeof payload?.sub === 'string' ? payload.sub : null
  if (!subject) return null
  const parts = subject.split('|')
  const userId = (parts.length > 1 ? parts[1] : parts[0]).trim()
  return userId ? `${userId}%3A%3A${accessToken}` : null
}

function identityFields(email: string | undefined, displayName?: string): Pick<BillingResult, 'email' | 'displayName'> {
  return {
    email: email ?? null,
    displayName: displayName ?? null,
  }
}

async function connectPost(url: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'User-Agent': 'tokmon',
      },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { __status: res.status }
    return await readJson(res)
  } catch {
    return null
  }
}

async function connectGetWithSession(url: string, token: string): Promise<any | null> {
  const session = cursorSessionToken(token)
  if (!session) return null
  try {
    const res = await fetch(url, {
      headers: {
        'Cookie': `WorkosCursorSessionToken=${session}`,
        'User-Agent': 'tokmon',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { __status: res.status }
    return await readJson(res)
  } catch {
    return null
  }
}

function onDemandSpendCents(su: SpendLimitUsage, limit: number, remaining: number): number {
  for (const raw of [su.individualUsed, su.pooledUsed, su.totalSpend]) {
    const n = numberValue(raw)
    if (n !== undefined && n > 0) return n
  }
  const inferred = Math.max(0, limit - remaining)
  if (inferred > 0) return inferred
  return numberValue(su.individualUsed) ?? numberValue(su.pooledUsed) ?? numberValue(su.totalSpend) ?? 0
}

function appendCredits(metrics: Metric[], creditGrants: CreditGrantsResponse | null, stripe: any): void {
  const stripeBalance = numberValue(stripe?.customerBalance)
  const stripeBalanceCents = stripeBalance !== undefined && stripeBalance < 0 ? Math.abs(stripeBalance) : 0
  const hasGrants = creditGrants?.hasCreditGrants === true
  const grantTotal = hasGrants ? numberValue(creditGrants?.totalCents) ?? 0 : 0
  const grantUsed = hasGrants ? numberValue(creditGrants?.usedCents) ?? 0 : 0
  const hasValidGrants = hasGrants && grantTotal > 0
  const total = (hasValidGrants ? grantTotal : 0) + stripeBalanceCents
  if (total <= 0) return
  metrics.push({ label: 'Credits', used: dollars(Math.max(0, total - (hasValidGrants ? grantUsed : 0))), limit: null, format: { kind: 'dollars' } })
}

export async function cursorBilling(account: Account): Promise<BillingResult> {
  const [core, activity, spend] = await Promise.all([
    cursorBillingCore(account),
    cursorActivity(account.homeDir),
    cursorModelSpend(account.homeDir),
  ])
  let merged = activity
  if (spend) {
    const lines = activity?.summary ?? ''
    const spendLabel = `$${Math.round(finite(spend.total))} all-time`
    merged = {
      series: activity?.series ?? [],
      summary: lines ? `${lines} · ${spendLabel}` : spendLabel,
    }
  }
  const modelSpend = spend?.models?.length
    ? spend.models.map(m => ({ name: m.name, usd: finite(m.usd), requests: finite(m.requests) }))
    : null
  return { ...core, activity: merged, modelSpend }
}

async function cursorBillingCore(account: Account): Promise<BillingResult> {
  const db = cursorStateDb(account.homeDir)
  const [tokenRes, membershipRes, emailRes, nameRes] = await Promise.all([
    readState(db, 'cursorAuth/accessToken'),
    readState(db, 'cursorAuth/stripeMembershipType'),
    readState(db, 'cursorAuth/cachedEmail'),
    readState(db, 'cursorAuth/cachedName'),
  ])
  const token = cleanStoredString(tokenRes.value)
  const membership = membershipRes.value
  const email = cleanStoredString(emailRes.value)
  const displayName = cleanStoredString(nameRes.value)
  const planFallback = membership ? membership.charAt(0).toUpperCase() + membership.slice(1) : null

  if (!token) {
    const error = tokenRes.status === 'ok' ? 'Not signed in — open Cursor' : sqliteStatusMessage(tokenRes.status)
    return { plan: planFallback, metrics: [], error, ...identityFields(email, displayName) }
  }

  const [usage, planInfo, creditGrants, stripe] = await Promise.all([
    connectPost(USAGE_URL, token) as Promise<UsageResponse & { __status?: number } | null>,
    connectPost(PLAN_URL, token),
    connectPost(CREDITS_URL, token) as Promise<CreditGrantsResponse | null>,
    connectGetWithSession(STRIPE_URL, token),
  ])
  if (!usage || usage.__status) {
    const expired = usage?.__status === 401 || usage?.__status === 403
    return { plan: planFallback, metrics: [], error: expired ? 'Token expired — re-open Cursor' : 'Cursor API error', ...identityFields(email, displayName) }
  }

  const planName = planInfo?.planInfo?.planName ?? planFallback
  const price = planInfo?.planInfo?.price
  const plan = planName ? (price ? `${planName} · ${price}` : planName) : null

  const pu = usage.planUsage ?? {}
  const metrics: Metric[] = []
  const rawEnd = usage.billingCycleEnd
  const endMs = numberValue(rawEnd) ?? NaN
  const iso = msToIso(endMs)
  const resets = iso && endMs > 0 ? resetIn(iso) : null

  appendCredits(metrics, creditGrants, stripe)

  const limit = numberValue(pu.limit)
  const planUsedCents = numberValue(pu.totalSpend)
    ?? (limit !== undefined && numberValue(pu.remaining) !== undefined ? limit - numberValue(pu.remaining)! : undefined)
  const computedPercent = limit !== undefined && limit > 0 && planUsedCents !== undefined ? (planUsedCents / limit) * 100 : undefined
  const totalPercentUsed = numberValue(pu.totalPercentUsed) ?? computedPercent
  const su = usage.spendLimitUsage
  const planLower = typeof planName === 'string' ? planName.trim().toLowerCase() : ''
  const pooledLimit = numberValue(su?.pooledLimit) ?? 0
  const isTeamAccount = planLower === 'team' || String(su?.limitType ?? '').toLowerCase() === 'team' || pooledLimit > 0

  if (isTeamAccount && limit !== undefined && planUsedCents !== undefined) {
    metrics.push({
      label: 'Usage',
      used: dollars(Math.max(0, planUsedCents)),
      limit: dollars(limit),
      format: { kind: 'dollars' },
      resetsAt: resets,
      primary: true,
    })
  } else if (totalPercentUsed !== undefined) {
    metrics.push(percentMetric('Usage', totalPercentUsed, resets, true))
    if (limit !== undefined && planUsedCents !== undefined) {
      metrics.push({
        label: 'Spend',
        used: dollars(Math.max(0, planUsedCents)),
        limit: dollars(limit),
        format: { kind: 'dollars' },
      })
    }
  }

  const autoPercentUsed = numberValue(pu.autoPercentUsed)
  if (autoPercentUsed !== undefined) {
    metrics.push({ label: 'Auto', used: autoPercentUsed, limit: 100, format: { kind: 'percent' } })
  }
  const apiPercentUsed = numberValue(pu.apiPercentUsed)
  if (apiPercentUsed !== undefined) {
    metrics.push({ label: 'API', used: apiPercentUsed, limit: 100, format: { kind: 'percent' } })
  }

  if (su) {
    const pair = numberValue(su.individualLimit) !== undefined && numberValue(su.individualRemaining) !== undefined
      ? { limit: numberValue(su.individualLimit)!, remaining: numberValue(su.individualRemaining)! }
      : numberValue(su.pooledLimit) !== undefined && numberValue(su.pooledRemaining) !== undefined
        ? { limit: numberValue(su.pooledLimit)!, remaining: numberValue(su.pooledRemaining)! }
        : null
    const spent = onDemandSpendCents(su, pair?.limit ?? 0, pair?.remaining ?? 0)
    if (pair && pair.limit > 0) {
      metrics.push({
        label: 'On-demand',
        used: dollars(spent),
        limit: dollars(pair.limit),
        format: { kind: 'dollars' },
      })
    } else if (spent > 0) {
      metrics.push({
        label: 'On-demand',
        used: dollars(spent),
        limit: null,
        format: { kind: 'dollars' },
      })
    }
  }

  if (metrics.length === 0) {
    return { plan, metrics: [], error: usage.enabled === false ? 'No active subscription' : 'No usage data', ...identityFields(email, displayName) }
  }
  return { plan, metrics, error: null, ...identityFields(email, displayName) }
}
