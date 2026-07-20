import type { Account, BillingResult } from './providers/types'
import type { DashboardData } from './types'
import type { AccountIdentityView, HeadroomView, QuotaView } from './usage-semantics'

export interface AccountStats {
  account: Account
  dashboard: DashboardData | null
  billing: BillingResult | null
  billingUpdatedAt?: number | null
  identity?: AccountIdentityView
  quotas?: QuotaView[]
  headroom?: HeadroomView
  providerHeadroom?: HeadroomView
}
