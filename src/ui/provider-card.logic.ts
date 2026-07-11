// Pure plan-display logic for ProviderCard. No Ink/React imports so it is unit-testable.

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
