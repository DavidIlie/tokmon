import { detectAccountProviders, PROVIDERS } from '../providers'
import { collectAccounts } from '../accounts'
import { resolveTimezone } from '../tz'
import type { Config, DetectedAccountRef } from '../config'
import type { Account, BillingResult, ProviderId } from '../providers/types'
import type { DashboardData, TableData } from '../types'
import { colorHex, namedHex } from '../shared/colors'
import type {
  WebSnapshot, WebAccount, WebProviderInfo, AccountFetchState, PeakStatus,
} from './contract'
import { deriveAccountIdentity, deriveProviderHeadroom, deriveQuotaViews } from '../usage-semantics'

export interface ResolvedAccount {
  account: Account
  hasUsage: boolean
  hasBilling: boolean
  color: string
}

export interface ResolvedAccounts {
  resolved: ResolvedAccount[]
  /** Exclusions that suppressed a home discovery actually found (see collectAccounts). */
  suppressed: DetectedAccountRef[]
}

export async function resolveAccounts(config: Config): Promise<ResolvedAccounts> {
  const detected = await detectAccountProviders()
  const { accounts, suppressed } = collectAccounts(config, detected)
  return {
    resolved: accounts.map(a => {
      const p = PROVIDERS[a.providerId]
      return {
        account: a,
        hasUsage: p.hasUsage || !!p.fetchTable,
        hasBilling: p.hasBilling,
        color: colorHex(a.color, PROVIDERS[a.providerId].color),
      }
    }),
    suppressed,
  }
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

export async function fetchAccountBilling(account: Account, tz: string): Promise<BillingResult | null> {
  const p = PROVIDERS[account.providerId]
  if (!p.fetchBilling) return null
  return p.fetchBilling(account, tz)
}

export function assembleSnapshot(opts: {
  version: string
  tz: string
  intervalMs: number
  billingIntervalMs: number
  resolved: ResolvedAccount[]
  installedProviders?: ProviderId[]
  usage: Map<string, { dashboard: DashboardData | null; table: TableData | null }>
  billing: Map<string, BillingResult | null>
  summaryState?: Map<string, AccountFetchState>
  billingState?: Map<string, AccountFetchState>
  tableState?: Map<string, AccountFetchState>
  summaryUpdatedAt?: Map<string, number>
  billingUpdatedAt?: Map<string, number>
  tableUpdatedAt?: Map<string, number>
  suppressedAccounts?: readonly DetectedAccountRef[]
  seeded?: boolean
  peak?: PeakStatus | null
  config: Config
}): WebSnapshot {
  const providerOrdinals = new Map<string, number>()
  const accounts: WebAccount[] = opts.resolved.map(r => {
    const u = opts.usage.get(r.account.id)
    const billing = opts.billing.get(r.account.id) ?? null
    const ordinal = (providerOrdinals.get(r.account.providerId) ?? 0) + 1
    providerOrdinals.set(r.account.providerId, ordinal)
    const quotas = deriveQuotaViews(billing?.metrics ?? [])
    return {
      id: r.account.id,
      providerId: r.account.providerId,
      name: r.account.name,
      color: r.color,
      homeDir: r.account.homeDir ?? null,
      source: r.account.source ?? 'auto',
      hasUsage: r.hasUsage,
      hasBilling: r.hasBilling,
      email: billing?.email ?? null,
      displayName: billing?.displayName ?? null,
      identity: deriveAccountIdentity({
        name: r.account.name,
        email: billing?.email,
        displayName: billing?.displayName,
        providerName: PROVIDERS[r.account.providerId].name,
        ordinal,
        privacyMode: opts.config.privacyMode,
      }),
      quotas,
      headroom: deriveProviderHeadroom([{
        id: r.account.id,
        lastActivityAt: u?.dashboard?.lastActivityAt ?? null,
        quotas,
      }], opts.config.tray.activeTimeoutMin, Date.now(), opts.config.tray.displayMetric),
      plan: billing?.plan ?? null,
      lastActivityAt: u?.dashboard?.lastActivityAt ?? null,
      dashboard: u?.dashboard ?? null,
      table: u?.table ?? null,
      billing,
      summaryState: opts.summaryState?.get(r.account.id) ?? 'pending',
      billingState: opts.billingState?.get(r.account.id) ?? 'pending',
      tableState: opts.tableState?.get(r.account.id) ?? 'pending',
      summaryUpdatedAt: opts.summaryUpdatedAt?.get(r.account.id) ?? null,
      billingUpdatedAt: opts.billingUpdatedAt?.get(r.account.id) ?? null,
      tableUpdatedAt: opts.tableUpdatedAt?.get(r.account.id) ?? null,
    }
  })

  const accountsByProvider = new Map<string, WebAccount[]>()
  for (const account of accounts) {
    const group = accountsByProvider.get(account.providerId) ?? []
    group.push(account)
    accountsByProvider.set(account.providerId, group)
  }

  const seen = new Set<string>()
  const providers: WebProviderInfo[] = []
  for (const r of opts.resolved) {
    if (seen.has(r.account.providerId)) continue
    seen.add(r.account.providerId)
    providers.push({
      id: r.account.providerId,
      name: PROVIDERS[r.account.providerId].name,
      color: namedHex(PROVIDERS[r.account.providerId].color),
      headroom: deriveProviderHeadroom(
        (accountsByProvider.get(r.account.providerId) ?? []).map(account => ({
          id: account.id,
          lastActivityAt: account.lastActivityAt,
          quotas: account.quotas ?? [],
        })),
        opts.config.tray.activeTimeoutMin,
        Date.now(),
        opts.config.tray.displayMetric,
      ),
    })
  }

  return {
    version: opts.version,
    generatedAt: Date.now(),
    tz: opts.tz,
    intervalMs: opts.intervalMs,
    billingIntervalMs: opts.billingIntervalMs,
    // Conditional like suppressedAccounts below: optionalKey wire fields must
    // be absent, never present-with-undefined, or Schema.encode rejects them.
    ...(opts.installedProviders ? { installedProviders: opts.installedProviders } : {}),
    providers,
    accounts,
    // Omitted rather than empty when the resolution did not report liveness, so
    // the field's absence keeps meaning "this daemon cannot tell you".
    ...(opts.suppressedAccounts ? { suppressedAccounts: opts.suppressedAccounts } : {}),
    seeded: opts.seeded ?? false,
    peak: opts.peak ?? null,
  }
}

export function tzFor(config: Config): string {
  return resolveTimezone(config.timezone)
}
