import { PROVIDERS, type Account, type ProviderId } from '../providers'
import type { Slot } from '../app.logic'
import { redactEmail } from '../config'
import { accountIdentityText, accountProviderOrdinals, projectAccountIdentity, type AccountIdentityView } from '../usage-semantics'
import { truncateName } from './shared'

interface PrivacyLabelRow {
  id: string
  providerId: ProviderId
  name: string
}

interface PrivacyLabelAccount {
  id: string
  providerId: ProviderId
  identity?: AccountIdentityView | null
}

/**
 * One strict privacy label per account, for every TUI surface that names an
 * account. Empty when privacy mode is off, so each surface keeps its own
 * visible label and nothing about the normal view changes.
 *
 * `resolved` is the daemon's account list in snapshot order — the ordinal
 * source that matches what the daemon, web and desktop already display — or the
 * locally built accounts when running degraded.
 */
export function derivePrivacyLabels(input: {
  privacyMode: boolean
  rows: readonly PrivacyLabelRow[]
  resolved: readonly PrivacyLabelAccount[]
}): Map<string, string> {
  const labels = new Map<string, string>()
  if (!input.privacyMode) return labels
  const ordinals = accountProviderOrdinals(input.resolved)
  const identities = new Map(input.resolved.map(account => [account.id, account.identity ?? null]))
  for (const row of input.rows) {
    if (labels.has(row.id)) continue
    labels.set(row.id, projectAccountIdentity({
      identity: identities.get(row.id),
      visible: row.name,
      providerName: PROVIDERS[row.providerId].name,
      // Removed and unresolved rows have no account behind them, so they carry
      // no ordinal rather than reusing a live account's.
      ordinal: ordinals.get(row.id) ?? null,
      privacyMode: true,
    }))
  }
  return labels
}

/**
 * The account title on a dashboard provider card. Privacy mode takes the strict
 * projection (`privacyLabel`) ahead of the snapshot identity, which the optimistic
 * local toggle outruns — trusting it names an account the strip already hid.
 */
export function resolveAccountTitle(input: {
  name: string
  email?: string | null
  identity?: AccountIdentityView | null
  providerName: string
  privacyMode: boolean
  privacyLabel?: string
}): string {
  if (input.privacyMode && input.privacyLabel) return input.privacyLabel
  if (input.identity) {
    const visible = accountIdentityText({ identity: input.identity, name: input.name }, input.providerName)
    return input.privacyMode ? redactEmail(visible) : visible
  }
  const title = input.email && !input.name.includes('@') ? `${input.name} ${input.email}` : input.name
  return input.privacyMode ? redactEmail(title) : title
}

/**
 * `privacyLabels` carries the shared strict projection (see
 * projectAccountIdentity), so the strip reads the same identity as the settings
 * list and the dashboard. redactEmail remains the fallback for an account the
 * projection did not cover; it cannot hide a display name that has no email.
 */
export function deriveSlots(
  accounts: Account[],
  privacyMode = false,
  privacyLabels?: ReadonlyMap<string, string>,
): Slot[] {
  const label = (account: Account) =>
    (privacyMode ? privacyLabels?.get(account.id) : undefined)
      ?? (privacyMode ? redactEmail(account.name) : account.name)
  return accounts.length > 1
    ? [{ id: null, name: 'All', color: 'whiteBright' }, ...accounts.map(a => ({ id: a.id, name: label(a), color: a.color }))]
    : accounts.map(a => ({ id: a.id, name: label(a), color: a.color }))
}

export function findActiveSlot(slots: Slot[], activeAccountId: string | null): { activeSlotIdx: number; focusId: string | null } {
  if (activeAccountId === null) return { activeSlotIdx: 0, focusId: slots[0]?.id ?? null }
  const i = slots.findIndex(s => s.id === activeAccountId)
  const activeSlotIdx = i < 0 ? 0 : i
  return { activeSlotIdx, focusId: slots[activeSlotIdx]?.id ?? null }
}

export function computeChrome(slots: Slot[], cols: number, rows: number): {
  hasStrip: boolean
  stripChipW: (s: Slot) => number
  stripChars: number
  stripLines: number
  headerRows: number
  CHROME: number
  gridBudget: number
} {
  const hasStrip = slots.length > 1
  const stripChipW = (s: Slot) => 2 + 2 + truncateName(s.name, 16).length + 2
  const stripChars = slots.reduce((sum, s) => sum + stripChipW(s), 0)
  const stripLines = hasStrip ? Math.max(1, Math.ceil(stripChars / Math.max(1, cols - 4 - 7))) : 0
  const headerRows = cols < 70 ? 2 : 1
  const CHROME = 2 + headerRows + 3 + (hasStrip ? 1 + stripLines : 0) + 2 + 2
  const gridBudget = Math.max(1, rows - CHROME)
  return { hasStrip, stripChipW, stripChars, stripLines, headerRows, CHROME, gridBudget }
}
