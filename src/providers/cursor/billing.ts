import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resetIn } from '../../format'
import { envDir } from '../../config'
import { readJson } from '../../http'
import type { Account, BillingResult, Metric } from '../types'
import { cursorActivity } from './activity'
import { cursorModelSpend } from './composer'
import { runSqlite, sqliteStatusMessage, type SqliteStatus } from './sqlite'

const BASE = 'https://api2.cursor.sh/aiserver.v1.DashboardService'
const USAGE_URL = `${BASE}/GetCurrentPeriodUsage`
const PLAN_URL = `${BASE}/GetPlanInfo`

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
  pooledLimit?: number
  pooledRemaining?: number
}
interface UsageResponse {
  billingCycleStart?: string
  billingCycleEnd?: string
  planUsage?: PlanUsage
  spendLimitUsage?: SpendLimitUsage
  enabled?: boolean
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

const dollars = (cents: number): number => cents / 100

export async function cursorBilling(account: Account): Promise<BillingResult> {
  const [core, activity, spend] = await Promise.all([
    cursorBillingCore(account),
    cursorActivity(account.homeDir),
    cursorModelSpend(account.homeDir),
  ])
  let merged = activity
  if (spend) {
    const lines = activity?.summary ?? ''
    const spendLabel = `$${Math.round(spend.total)} all-time`
    merged = {
      series: activity?.series ?? [],
      summary: lines ? `${lines} · ${spendLabel}` : spendLabel,
    }
  }
  const modelSpend = spend?.models?.length
    ? spend.models.slice(0, 6).map(m => ({ name: m.name, usd: m.usd, requests: m.requests }))
    : null
  return { ...core, activity: merged, modelSpend }
}

async function cursorBillingCore(account: Account): Promise<BillingResult> {
  const db = cursorStateDb(account.homeDir)
  const [tokenRes, membershipRes] = await Promise.all([
    readState(db, 'cursorAuth/accessToken'),
    readState(db, 'cursorAuth/stripeMembershipType'),
  ])
  const token = tokenRes.value
  const membership = membershipRes.value
  const planFallback = membership ? membership.charAt(0).toUpperCase() + membership.slice(1) : null

  if (!token) {
    const error = tokenRes.status === 'ok' ? 'Not signed in — open Cursor' : sqliteStatusMessage(tokenRes.status)
    return { plan: planFallback, metrics: [], error }
  }

  const [usage, planInfo] = await Promise.all([
    connectPost(USAGE_URL, token) as Promise<UsageResponse & { __status?: number } | null>,
    connectPost(PLAN_URL, token),
  ])
  if (!usage || usage.__status) {
    const expired = usage?.__status === 401 || usage?.__status === 403
    return { plan: planFallback, metrics: [], error: expired ? 'Token expired — re-open Cursor' : 'Cursor API error' }
  }

  const planName = planInfo?.planInfo?.planName ?? planFallback
  const price = planInfo?.planInfo?.price
  const plan = planName ? (price ? `${planName} · ${price}` : planName) : null

  const pu = usage.planUsage ?? {}
  const metrics: Metric[] = []
  const rawEnd = usage.billingCycleEnd
  const endMs = typeof rawEnd === 'string' && rawEnd.trim() ? Number(rawEnd) : NaN
  const resets = Number.isFinite(endMs) && endMs > 0 && endMs <= 8.64e15
    ? resetIn(new Date(endMs).toISOString()) : null

  if (typeof pu.totalPercentUsed === 'number' && typeof pu.limit === 'number') {
    metrics.push({
      label: 'Usage',
      used: pu.totalPercentUsed,
      limit: 100,
      format: { kind: 'percent' },
      resetsAt: resets,
      primary: true,
    })
    const spentCents = typeof pu.totalSpend === 'number' ? pu.totalSpend : pu.limit - (pu.remaining ?? 0)
    metrics.push({
      label: 'Spend',
      used: dollars(spentCents),
      limit: dollars(pu.limit),
      format: { kind: 'dollars' },
    })
  }

  if (pu.autoPercentUsed) {
    metrics.push({ label: 'Auto', used: pu.autoPercentUsed, limit: 100, format: { kind: 'percent' } })
  }
  if (pu.apiPercentUsed) {
    metrics.push({ label: 'API', used: pu.apiPercentUsed, limit: 100, format: { kind: 'percent' } })
  }

  const su = usage.spendLimitUsage
  if (su) {
    const limitCents = su.individualLimit ?? su.pooledLimit ?? 0
    const remainingCents = su.individualRemaining ?? su.pooledRemaining ?? 0
    if (limitCents > 0) {
      metrics.push({
        label: 'On-demand',
        used: dollars(limitCents - remainingCents),
        limit: dollars(limitCents),
        format: { kind: 'dollars' },
      })
    }
  }

  if (metrics.length === 0) {
    return { plan, metrics: [], error: usage.enabled === false ? 'No active subscription' : 'No usage data' }
  }
  return { plan, metrics, error: null }
}
