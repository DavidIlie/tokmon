import { detectProviders, PROVIDERS } from '../providers'
import { buildAccounts } from '../accounts'
import { resolveTimezone } from '../tz'
import type { Config } from '../config'
import type { Account, BillingResult } from '../providers/types'
import type { DashboardData, TableData } from '../types'
import { toJsonSafe } from '../json-safe'
import { colorHex, namedHex } from './colors'
import type {
  WebSnapshot, WebAccount, WebProviderInfo, AccountFetchState, PeakStatus,
} from './contract'

export interface ResolvedAccount {
  account: Account
  hasUsage: boolean
  hasBilling: boolean
  color: string
}

export async function resolveAccounts(config: Config): Promise<ResolvedAccount[]> {
  const detected = await detectProviders()
  const accounts = buildAccounts(config, detected)
  return accounts.map(a => {
    const p = PROVIDERS[a.providerId]
    return {
      account: a,
      hasUsage: p.hasUsage || !!p.fetchTable,
      hasBilling: p.hasBilling,
      color: colorHex(a.color, PROVIDERS[a.providerId].color),
    }
  })
}

export async function fetchAccountSummary(account: Account, tz: string): Promise<DashboardData | null> {
  const p = PROVIDERS[account.providerId]
  if (!p.fetchSummary) return null
  return p.fetchSummary(account, tz)
}

export async function fetchAccountTable(account: Account, tz: string): Promise<TableData | null> {
  const p = PROVIDERS[account.providerId]
  if (!p.fetchTable) return null
  return p.fetchTable(account, tz)
}

export async function fetchAccountBilling(account: Account): Promise<BillingResult | null> {
  const p = PROVIDERS[account.providerId]
  if (!p.fetchBilling) return null
  return p.fetchBilling(account)
}

export function assembleSnapshot(opts: {
  version: string
  tz: string
  intervalMs: number
  resolved: ResolvedAccount[]
  usage: Map<string, { dashboard: DashboardData | null; table: TableData | null }>
  billing: Map<string, BillingResult | null>
  summaryState?: Map<string, AccountFetchState>
  billingState?: Map<string, AccountFetchState>
  tableState?: Map<string, AccountFetchState>
  seeded?: boolean
  peak?: PeakStatus | null
}): WebSnapshot {
  const accounts: WebAccount[] = opts.resolved.map(r => {
    const u = opts.usage.get(r.account.id)
    return {
      id: r.account.id,
      providerId: r.account.providerId,
      name: r.account.name,
      color: r.color,
      hasUsage: r.hasUsage,
      hasBilling: r.hasBilling,
      dashboard: u?.dashboard ?? null,
      table: u?.table ?? null,
      billing: opts.billing.get(r.account.id) ?? null,
      summaryState: opts.summaryState?.get(r.account.id) ?? 'pending',
      billingState: opts.billingState?.get(r.account.id) ?? 'pending',
      tableState: opts.tableState?.get(r.account.id) ?? 'pending',
    }
  })

  const seen = new Set<string>()
  const providers: WebProviderInfo[] = []
  for (const r of opts.resolved) {
    if (seen.has(r.account.providerId)) continue
    seen.add(r.account.providerId)
    providers.push({
      id: r.account.providerId,
      name: PROVIDERS[r.account.providerId].name,
      color: namedHex(PROVIDERS[r.account.providerId].color),
    })
  }

  return toJsonSafe({
    version: opts.version,
    generatedAt: Date.now(),
    tz: opts.tz,
    intervalMs: opts.intervalMs,
    providers,
    accounts,
    seeded: opts.seeded ?? false,
    peak: opts.peak ?? null,
  })
}

export function tzFor(config: Config): string {
  return resolveTimezone(config.timezone)
}
