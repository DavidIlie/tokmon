import { detectProviders, PROVIDERS } from '../providers'
import { buildAccounts } from '../accounts'
import { resolveTimezone } from '../tz'
import type { Config } from '../config'
import type { Account, BillingResult } from '../providers/types'
import type { DashboardData, TableData } from '../types'
import { colorHex, namedHex } from './colors'
import type { WebSnapshot, WebAccount, WebProviderInfo } from './contract'

export interface ResolvedAccount {
  account: Account
  hasUsage: boolean
  hasBilling: boolean
  color: string
}

/** Detect installed providers and build the active account list from config. */
export async function resolveAccounts(config: Config): Promise<ResolvedAccount[]> {
  const detected = await detectProviders()
  // The web dashboard surfaces EVERY installed provider's data, regardless of which
  // are toggled off for the TUI — so opencode/pi/gemini/etc. show here even when the
  // terminal view hides them. (The TUI still honors config.disabledProviders.)
  const accounts = buildAccounts({ ...config, disabledProviders: [] }, detected)
  return accounts.map(a => {
    const p = PROVIDERS[a.providerId]
    return {
      account: a,
      // Web-only: a provider with a usage table (e.g. Cursor's local composer history)
      // shows in the dashboard's leaderboard/calendar/explore even when its TUI flag is
      // false. The TUI reads PROVIDERS[id].hasUsage directly, so it is unaffected.
      hasUsage: p.hasUsage || !!p.fetchTable,
      hasBilling: p.hasBilling,
      color: colorHex(a.color, PROVIDERS[a.providerId].color),
    }
  })
}

export async function fetchAccountSummary(account: Account, tz: string): Promise<DashboardData | null> {
  const p = PROVIDERS[account.providerId]
  if (!p.fetchSummary) return null
  return p.fetchSummary(account, tz).catch(() => null)
}

export async function fetchAccountTable(account: Account, tz: string): Promise<TableData | null> {
  const p = PROVIDERS[account.providerId]
  if (!p.fetchTable) return null
  return p.fetchTable(account, tz).catch(() => null)
}

export async function fetchAccountBilling(account: Account): Promise<BillingResult | null> {
  const p = PROVIDERS[account.providerId]
  if (!p.fetchBilling) return null
  return p.fetchBilling(account).catch(() => null)
}

export function assembleSnapshot(opts: {
  version: string
  tz: string
  intervalMs: number
  resolved: ResolvedAccount[]
  usage: Map<string, { dashboard: DashboardData | null; table: TableData | null }>
  billing: Map<string, BillingResult | null>
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

  return {
    version: opts.version,
    generatedAt: Date.now(),
    tz: opts.tz,
    intervalMs: opts.intervalMs,
    providers,
    accounts,
  }
}

export function tzFor(config: Config): string {
  return resolveTimezone(config.timezone)
}
