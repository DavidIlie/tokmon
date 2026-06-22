import type { Account, BillingResult } from './providers/types'
import type { DashboardData } from './types'

export interface AccountStats {
  account: Account
  dashboard: DashboardData | null
  billing: BillingResult | null
}
