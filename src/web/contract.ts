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
}
