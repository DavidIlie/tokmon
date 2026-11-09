import type { Metric, WebAccount, WebSnapshot } from '../../web/contract'
import type { PromotionAccount } from './promotion'
import { resolveQuotaViews, tightestQuotaView, usageFromHeadroom, type HeadroomView } from '../../usage-semantics'
import { percentText, providerFreshness, providerRepresentative, resetLabel, severity, severityTag } from '../shared/presentation'
import { accountIdentity } from '../shared/privacy'

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

/** Provider tooltip copy uses the same quota contributors and ages as the popover. */
export function providerTooltipLine(
  providerName: string,
  accounts: readonly WebAccount[],
  privacy: boolean,
  snapshot: WebSnapshot,
  activeTimeoutMin: number,
  now: number,
  headroom?: HeadroomView,
): string {
  const rep = providerRepresentative(accounts, activeTimeoutMin, now)
  let line: string
  if (headroom) {
    if (headroom.value === null) return `${providerName} — no usage data yet`
    const account = accounts.find(candidate => candidate.id === headroom.representativeAccountId)
    const identity = account && accounts.length > 1 ? ` · ${accountIdentity(account, privacy)}` : ''
    line = `${providerName} — Usage ${percentText(usageFromHeadroom(headroom.value))}${identity}`
  } else {
    if (rep.noData || !rep.quota || !rep.account) return `${providerName} — no usage data yet`
    const multi = accounts.length > 1
    const identity = multi ? `${accountIdentity(rep.account, privacy)} · ` : ''
    line = `${providerName} — ${identity}${rep.quota.label} ${percentText(rep.quota.used)} used`
    const word = severityTag(severity(rep.quota.remaining))
    const reset = resetLabel(rep.quota.resetsAt, now)
    if (word) line += `, ${word}`
    if (reset) line += `, ${reset}`
    if (multi && rep.dataCount > 1 && rep.runwayPct !== null) {
      line += ` · ${rep.dataCount} accounts, lowest account usage ${percentText(100 - rep.runwayPct)}`
    }
  }
  const status = providerFreshness(accounts, snapshot, now, headroom, rep.account)
  if (status.label) line += ` · ${status.label} · ${status.title}`
  return line
}
