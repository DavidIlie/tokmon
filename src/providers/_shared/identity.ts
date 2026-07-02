import type { BillingResult } from '../types'

export function identityFields(identity: { email?: string; displayName?: string } | null | undefined): Pick<BillingResult, 'email' | 'displayName'> {
  return {
    email: identity?.email ?? null,
    displayName: identity?.displayName ?? null,
  }
}
