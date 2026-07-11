// Pure plan-display logic for ProviderCard. No Ink/React imports so it is unit-testable.

import { formatAgo } from '../shared/format'

// The daemon pauses billing polls while no viewer is attached, so re-attaching can
// briefly render an hours-old quota card before the forced refresh lands. Anything
// older than this is flagged so frozen bars can't masquerade as current. Comfortably
// above the default 5-minute poll so it never fires during normal operation.
export const BILLING_STALE_AFTER_MS = 30 * 60_000

/** Label like "as of 9h ago" when billing data is old enough to mislead, else null. */
export function billingStaleLabel(billingUpdatedAt: number | null | undefined, now: number): string | null {
  if (billingUpdatedAt == null || billingUpdatedAt <= 0) return null
  if (now - billingUpdatedAt < BILLING_STALE_AFTER_MS) return null
  return `as of ${formatAgo(billingUpdatedAt, now)}`
}

/** Normalize a raw plan value: null/undefined/empty/whitespace-only → null; otherwise trimmed. */
export function normalizePlan(plan: string | null | undefined): string | null {
  if (plan == null) return null
  const t = plan.trim()
  return t === '' ? null : t
}

export type PlanDisplay =
  | { mode: 'none' }                    // no plan to show in the header
  | { mode: 'header'; plan: string }    // single account, or all accounts share one plan
  | { mode: 'perRow'; count: number }   // plans differ → header shows "{count} accounts", rows carry plans

/**
 * Decide how to display subscription plans for a provider card.
 * rawPlans is one entry per account (order matches items), each = billing?.plan.
 *
 * Semantics:
 *  - '' / whitespace is treated as null (absent), matching the old find(Boolean) normalization.
 *  - Single account: show its plan in the header (or nothing if null).
 *  - Multiple accounts: header shows the common plan ONLY when every account has a non-null
 *    plan and all are equal. A null among named plans counts as "differing" (perRow).
 *  - All-null (any count): nothing anywhere ('none').
 */
export function planDisplay(rawPlans: (string | null | undefined)[]): PlanDisplay {
  const plans = rawPlans.map(normalizePlan)
  const named = plans.filter((p): p is string => p != null)
  if (named.length === 0) return { mode: 'none' }
  if (plans.length === 1) return { mode: 'header', plan: named[0] }
  const allNamed = named.length === plans.length
  const allEqual = named.every(p => p === named[0])
  if (allNamed && allEqual) return { mode: 'header', plan: named[0] }
  return { mode: 'perRow', count: plans.length }
}
