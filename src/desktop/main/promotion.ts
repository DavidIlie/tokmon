import type { TrayConfig } from '../../config-schema'

const MINUTE_MS = 60_000
export const IMMEDIATE_OVERRIDE_REMAINING_PCT = 10

export interface PromotionAccount {
  id: string
  /** Unix milliseconds of the newest real usage event, never a refresh time. */
  lastActivityAt: number | null
  /** Tightest quota remaining across the account's bounded quota metrics. */
  remainingPct: number | null
  /** Soonest reset associated with the tightest quota, as Unix milliseconds. */
  resetsAt?: number | null
}

export interface PromotionState {
  primaryId: string | null
  /** Time at which primaryId last changed. */
  promotedAt: number | null
}

export interface PromotionResult {
  /** At most two visible account IDs, primary first. */
  slots: string[]
  /** Every remaining account in deterministic popover order. */
  overflow: string[]
  state: PromotionState
}

export type PromotionConfig = Pick<
  TrayConfig,
  'activeTimeoutMin' | 'graceMin' | 'promotionHoldMin' | 'pinnedAccount'
>

function activityAt(account: PromotionAccount): number {
  return typeof account.lastActivityAt === 'number' && Number.isFinite(account.lastActivityAt)
    ? account.lastActivityAt
    : Number.NEGATIVE_INFINITY
}

function remaining(account: PromotionAccount): number {
  return typeof account.remainingPct === 'number' && Number.isFinite(account.remainingPct)
    ? account.remainingPct
    : Number.POSITIVE_INFINITY
}

function resetAt(account: PromotionAccount): number {
  return typeof account.resetsAt === 'number' && Number.isFinite(account.resetsAt)
    ? account.resetsAt
    : Number.POSITIVE_INFINITY
}

function compareId(a: PromotionAccount, b: PromotionAccount): number {
  return a.id.localeCompare(b.id)
}

function compareActivity(a: PromotionAccount, b: PromotionAccount): number {
  return activityAt(b) - activityAt(a) || compareId(a, b)
}

function compareQuota(a: PromotionAccount, b: PromotionAccount): number {
  return remaining(a) - remaining(b) || resetAt(a) - resetAt(b) || compareId(a, b)
}

function within(account: PromotionAccount, now: number, minutes: number): boolean {
  return activityAt(account) >= now - minutes * MINUTE_MS
}

function promotionAllowed(previous: PromotionState, now: number, holdMin: number): boolean {
  return previous.promotedAt === null || now - previous.promotedAt >= holdMin * MINUTE_MS
}

/**
 * Selects Tokmon's two tray accounts without reading clocks or mutating state.
 *
 * Hot accounts have activity within activeTimeoutMin. A visible incumbent stays
 * through graceMin. A strictly newer challenger can replace an expired incumbent,
 * subject to promotionHoldMin. A hot challenger at <=10% remaining bypasses both
 * grace and hold. When no account is recent, the tightest quota wins, then the
 * soonest reset, then account ID. A valid explicit pin always owns the first slot.
 */
export function selectPromotedAccounts(
  accounts: readonly PromotionAccount[],
  previous: PromotionState,
  config: PromotionConfig,
  now: number,
): PromotionResult {
  if (accounts.length === 0) {
    return { slots: [], overflow: [], state: { primaryId: null, promotedAt: null } }
  }

  const byId = new Map(accounts.map(account => [account.id, account]))
  const hot = accounts.filter(account => within(account, now, config.activeTimeoutMin)).sort(compareActivity)
  const recent = accounts.filter(account => within(account, now, config.graceMin)).sort(compareActivity)
  const fallback = [...accounts].sort(compareQuota)[0]
  const incumbent = previous.primaryId === null ? undefined : byId.get(previous.primaryId)
  const pinned = config.pinnedAccount === null ? undefined : byId.get(config.pinnedAccount)

  let primary: PromotionAccount

  if (pinned) {
    primary = pinned
  } else if (!incumbent) {
    primary = recent[0] ?? fallback
  } else {
    primary = incumbent
    const challenger = hot.find(account => account.id !== incumbent.id)
    const immediateOverride = challenger !== undefined
      && remaining(challenger) <= IMMEDIATE_OVERRIDE_REMAINING_PCT

    if (immediateOverride) {
      primary = challenger
    } else if (!within(incumbent, now, config.graceMin)) {
      const newestRecent = recent.find(account => account.id !== incumbent.id)
      const newerChallenger = newestRecent !== undefined
        && activityAt(newestRecent) > activityAt(incumbent)
        ? newestRecent
        : undefined
      const desired = newerChallenger ?? (recent.length === 0 ? fallback : incumbent)
      if (desired.id !== incumbent.id && promotionAllowed(previous, now, config.promotionHoldMin)) {
        primary = desired
      }
    }
  }

  const changed = primary.id !== previous.primaryId
  const nextState: PromotionState = {
    primaryId: primary.id,
    promotedAt: changed ? now : previous.promotedAt,
  }

  const secondary = hot.find(account => account.id !== primary.id)
    ?? [...accounts].filter(account => account.id !== primary.id).sort(compareQuota)[0]
  const slots = secondary ? [primary.id, secondary.id] : [primary.id]
  const slotted = new Set(slots)
  const remainingAccounts = accounts.filter(account => !slotted.has(account.id))
  const hotOverflow = remainingAccounts.filter(account => within(account, now, config.activeTimeoutMin)).sort(compareActivity)
  const nonHotOverflow = remainingAccounts.filter(account => !within(account, now, config.activeTimeoutMin)).sort(compareQuota)

  return {
    slots,
    overflow: [...hotOverflow, ...nonHotOverflow].map(account => account.id),
    state: nextState,
  }
}
