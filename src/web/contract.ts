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

export type { Config, Account, TrackedAccountRow, TrackedAccountSource } from '../config-schema'
export {
  formatAgo,
  formatCount,
  formatCurrency,
  formatCurrencyAxis,
  formatDayLabel,
  formatNumber,
  formatPercent,
  formatResetIn,
  formatShortDate,
  formatTime,
  formatTokens,
  sumTokens,
} from '../shared/format'
export {
  FALLBACK_HEX,
  NAMED_HEX,
  PROVIDER_HEX,
  TOKEN_BUCKET,
  colorHex,
  modelColor,
  namedColorHex,
  namedHex,
  providerHex,
  shortModel,
} from '../shared/colors'
export {
  normalizeConfig,
  generateAccountId,
  slugify,
  pickAccentColor,
  isValidTimezone,
  COLOR_PALETTE,
  PROVIDER_META,
  PROVIDER_ORDER,
  getTrackedAccountRows,
  sanitizeTyped,
} from '../config-schema'

export type AccountFetchState = 'pending' | 'ready' | 'error'

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
  email?: string | null
  displayName?: string | null
  plan?: string | null
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
  seeded: boolean
  peak: PeakStatus | null
}
