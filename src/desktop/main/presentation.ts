import type { Metric, WebAccount, WebSnapshot } from '../../web/contract'
import type { PromotionAccount } from './promotion'
import { resolveQuotaViews, tightestQuotaView } from '../../usage-semantics'
import { billingObservedAt, billingStaleAfterMs } from '../shared/presentation'

export interface TightestQuota {
  label: string
  remainingPct: number
  usedPct: number
  resetsAt: number | null
  /** Raw source retained for diagnostics when present on the snapshot. */
  metric: Metric | null
}

export function tightestQuota(account: WebAccount): TightestQuota | null {
  const metrics = account.billing?.metrics ?? []
  const quotas = resolveQuotaViews({ quotas: account.quotas, metrics })
  const quota = tightestQuotaView(quotas)
  if (!quota || quota.usedPct === null || quota.remainingPct === null) return null
  const metric = metrics.find((candidate, sourceIndex) =>
    (candidate.key ?? `${candidate.label}:${sourceIndex}`) === quota.key,
  ) ?? null
  return {
    label: quota.label,
    remainingPct: quota.remainingPct,
    usedPct: quota.usedPct,
    resetsAt: quota.resetsAt,
    metric,
  }
}

export function promotionAccounts(snapshot: WebSnapshot): PromotionAccount[] {
  return snapshot.accounts.map(account => {
    const quota = tightestQuota(account)
    return {
      id: account.id,
      lastActivityAt: account.lastActivityAt,
      remainingPct: quota?.remainingPct ?? null,
      resetsAt: quota?.resetsAt ?? null,
    }
  })
}

/**
 * Accounts with real usage activity inside the active window — emphasis only. Multiple
 * accounts qualify simultaneously; this never reorders anything and never touches pins.
 */
export function activeAccountIds(snapshot: WebSnapshot, activeTimeoutMin: number, now: number): string[] {
  const cutoff = now - activeTimeoutMin * 60_000
  return snapshot.accounts
    .filter(account => account.lastActivityAt !== null && account.lastActivityAt >= cutoff)
    .map(account => account.id)
}

export function quotaIsStale(account: WebAccount, snapshot: WebSnapshot, now = Date.now()): boolean {
  const observedAt = billingObservedAt(account)
  if (observedAt === null) return account.billingState !== 'pending'
  return now - observedAt > billingStaleAfterMs(snapshot)
}
