import type { Account } from '../providers'
import type { Slot } from '../app.logic'
import { truncateName } from './shared'

export function deriveSlots(accounts: Account[]): Slot[] {
  return accounts.length > 1
    ? [{ id: null, name: 'All', color: 'whiteBright' }, ...accounts.map(a => ({ id: a.id, name: a.name, color: a.color }))]
    : accounts.map(a => ({ id: a.id, name: a.name, color: a.color }))
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
