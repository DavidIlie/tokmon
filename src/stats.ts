import type { Account, BillingResult } from './providers/types'
import type { DashboardData } from './types'

/** Live per-account state held by the app and rendered by the views. */
export interface AccountStats {
  account: Account
  dashboard: DashboardData | null
  billing: BillingResult | null
}
