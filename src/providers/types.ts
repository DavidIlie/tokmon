import type { DashboardData, TableData } from '../types'

export type ProviderId = 'claude' | 'codex' | 'cursor'

/**
 * An account is one tracked identity within a provider. File-based providers
 * (Claude, Codex) locate data via `homeDir`; API-based providers (Cursor) use
 * the system install. A provider may have many accounts.
 */
export interface Account {
  id: string
  providerId: ProviderId
  name: string
  color: string
  /** Resolved path containing the provider's data dir (e.g. one holding `.claude/`). */
  homeDir?: string
}

/** How a limit metric's numbers should be rendered. */
export type MetricFormat =
  | { kind: 'percent' }
  | { kind: 'dollars'; currency?: string }
  | { kind: 'count'; suffix?: string }

/**
 * A single usage/limit reading — the unit every provider's billing reduces to.
 * `percent` metrics draw a bar; `dollars`/`count` render as plain values.
 */
export interface Metric {
  label: string
  used: number
  /** null = no defined ceiling (show the used value alone). */
  limit: number | null
  format: MetricFormat
  /** Pre-formatted countdown such as "3h 12m", or null when not applicable. */
  resetsAt?: string | null
  /** Marks the headline metric for compact views. */
  primary?: boolean
}

export interface BillingResult {
  plan: string | null
  metrics: Metric[]
  error: string | null
  /** Optional local activity history (e.g. Cursor AI-code lines/day) for a sparkline. */
  activity?: { series: number[]; summary: string } | null
}

/**
 * The adapter every provider implements. Capabilities are declared up front so
 * the UI can render only what a provider supports:
 *   - `hasUsage`  → token/cost history (fetchSummary / fetchTable)
 *   - `hasBilling`→ rate limits / spend (fetchBilling)
 */
export interface Provider {
  id: ProviderId
  name: string
  /** Brand accent color (Ink color name or hex). */
  color: string
  hasUsage: boolean
  hasBilling: boolean
  /** True when this provider has data for the given home (or its default). */
  detect(homeDir?: string): Promise<boolean>
  fetchSummary?(account: Account, tz: string): Promise<DashboardData>
  fetchTable?(account: Account, tz: string): Promise<TableData>
  fetchBilling?(account: Account): Promise<BillingResult>
}
