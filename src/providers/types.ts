import type { DashboardData, TableData } from '../types'

export const PROVIDER_IDS = ['claude', 'codex', 'cursor', 'copilot', 'pi', 'opencode', 'antigravity', 'gemini'] as const

export type ProviderId = typeof PROVIDER_IDS[number]

export interface Account {
  id: string
  providerId: ProviderId
  name: string
  color: string
  homeDir?: string
}

export type MetricFormat =
  | { kind: 'percent' }
  | { kind: 'dollars'; currency?: string }
  | { kind: 'count'; suffix?: string }

export interface Metric {
  label: string
  used: number
  limit: number | null
  format: MetricFormat
  resetsAt?: string | null
  primary?: boolean
}

export interface BillingResult {
  plan: string | null
  metrics: Metric[]
  error: string | null
  email?: string | null
  displayName?: string | null
  activity?: { series: number[]; summary: string } | null
  modelSpend?: { name: string; usd: number; requests: number }[] | null
}

export interface Provider {
  id: ProviderId
  name: string
  color: string
  hasUsage: boolean
  hasBilling: boolean
  detect(homeDir?: string): Promise<boolean>
  fetchSummary?(account: Account, tz: string): Promise<DashboardData>
  fetchTable?(account: Account, tz: string): Promise<TableData>
  fetchBilling?(account: Account): Promise<BillingResult>
}
