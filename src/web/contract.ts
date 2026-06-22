import type { DashboardData, TableData } from '../types'
import type { BillingResult, ProviderId } from '../providers/types'

export type {
  DashboardData,
  TableData,
  TableRow,
  ModelDetail,
  UsageSummary,
} from '../types'
export type {
  BillingResult,
  Metric,
  MetricFormat,
  ProviderId,
} from '../providers/types'

// Browser-safe shared config schema. config-schema.ts is node-free, so the SPA
// can import these via the @shared alias without breaking the Vite build.
export type { Config, Account } from '../config-schema'
export {
  normalizeConfig,
  generateAccountId,
  slugify,
  pickAccentColor,
  isValidTimezone,
  COLOR_PALETTE,
  PROVIDER_META,
  PROVIDER_ORDER,
  sanitizeTyped,
} from '../config-schema'

// Per-account fetch lifecycle. 'ready' is set even when the resolved value is
// null (e.g. a provider with no dashboard), so the loader can distinguish
// "resolved to empty" from "still loading" from "fetch threw".
export type AccountFetchState = 'pending' | 'ready' | 'error'

// Anthropic peak / off-peak pricing clock status. Defined HERE (not re-exported
// from src/peak.ts) so the browser's @shared import of this module never
// transitively pulls the node-only ./http dependency that peak.ts uses.
export interface PeakStatus {
  state: 'peak' | 'off-peak' | 'weekend'
  label: string
  minutesUntilChange: number | null
}

export interface WebAccount {
  id: string
  providerId: ProviderId
  name: string
  color: string
  hasUsage: boolean
  hasBilling: boolean
  dashboard: DashboardData | null
  table: TableData | null
  billing: BillingResult | null
  summaryState: AccountFetchState
  billingState: AccountFetchState
  tableState: AccountFetchState
}

export interface WebProviderInfo {
  id: ProviderId
  name: string
  color: string
}

export interface WebSnapshot {
  version: string
  generatedAt: number
  tz: string
  intervalMs: number
  providers: WebProviderInfo[]
  accounts: WebAccount[]
  // true while serving cache-hydrated data before the first live rebuild().
  seeded: boolean
  // global peak/off-peak clock; null when unknown or no claude account present.
  peak: PeakStatus | null
}
