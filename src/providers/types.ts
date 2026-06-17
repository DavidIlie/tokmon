import type { DashboardData, TableData } from '../types'

export type ProviderId = 'claude' | 'codex' | 'cursor' | 'pi' | 'opencode' | 'copilot' | 'antigravity' | 'gemini'

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
  activity?: { series: number[]; summary: string } | null
  /** Optional per-model spend breakdown (Cursor) — additive; other providers omit it. */
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
