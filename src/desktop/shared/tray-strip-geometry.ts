import { severity } from '../../usage-semantics'

// ── Menu-bar strip geometry (binding, measured in points; 1pt = 2px @2×) ──────
// Every element shares one 11pt optical centreline. Twin segments stay twins: the
// numeral slot is shared and centred. No divider and no punctuation-based alert;
// urgency words live in the tooltip/popover where they remain unambiguous.
export const TRAY_STRIP = {
  height: 22,
  centerY: 11,
  iconBox: 13,
  iconTop: 4.5,
  gapIconNum: 3,
  gapSeg: 8,
  edgeBleed: 1,
  baselineY: 15,
  fontPx: 11,
  fontWeight: 500,
  /** Active badge: r1.25 dot punched into a r2.25 halo at the icon's upper-right. */
  activeDotRadius: 1.25,
  activeHaloRadius: 2.25,
  activeCenterX: 12.5,
  activeCenterY: 4.5,
  unknownAlpha: 0.45,
} as const

export interface TraySegmentValue {
  providerId: string
  /** Representative usage %, or null for unknown (no bounded data). */
  usage: number | null
  /** Optional alternate value such as today's compact token count. */
  label?: string
  active: boolean
}

/** The usage numeral: "7%", "<1%", "100%", or an en dash for unknown. Never "!7%". */
export function trayLabel(usage: number | null): string {
  if (usage === null || !Number.isFinite(usage)) return '–' // en dash
  if (usage > 0 && usage < 1) return '<1%'
  return `${Math.round(usage)}%`
}

/** Critical in the bar means at least 90% consumed (≤10% headroom). */
export function trayCritical(usage: number | null): boolean {
  return usage !== null && Number.isFinite(usage) && severity(100 - usage) === 'crit'
}

const ceilHalf = (value: number) => Math.ceil(value * 2) / 2

/**
 * Shared digit count for the numeral slot: `max(2, widest known)`. The 3-digit
 * slot is held from 98% up so the 99↔100 reset boundary never flutters an edge.
 */
export function trayStripDigits(values: readonly TraySegmentValue[]): number {
  let digits = 2
  for (const value of values) {
    if (value.usage === null || !Number.isFinite(value.usage)) continue
    const shown = value.usage > 0 && value.usage < 1 ? 1 : Math.round(value.usage)
    digits = Math.max(digits, shown >= 98 ? 3 : String(Math.max(0, shown)).length)
  }
  return digits
}

export interface TraySegmentLayout {
  providerId: string
  usage: number | null
  active: boolean
  critical: boolean
  label: string
  /** Left edge of the whole segment. */
  x: number
  /** Left edge of the icon box (== x). */
  iconX: number
  /** Left edge of the shared numeral slot. */
  numLeft: number
  /** Horizontal centre of the numeral slot; the numeral is centred here. */
  numCenterX: number
}

export interface TrayStripLayout {
  width: number
  height: number
  digits: number
  slotWidth: number
  segWidth: number
  segments: TraySegmentLayout[]
}

/**
 * Compute the strip layout. Text metrics are injected so this stays pure and unit
 * testable (the painter passes `ctx.measureText`). Severity never changes geometry,
 * so low values cannot make one provider look more padded than another.
 */
export function trayStripLayout(
  values: readonly TraySegmentValue[],
  measureText: (text: string) => number,
): TrayStripLayout {
  const { iconBox, gapIconNum, gapSeg, edgeBleed, height } = TRAY_STRIP
  const digits = trayStripDigits(values)
  const labels = values.map(value => value.label ?? trayLabel(value.usage))
  const criticals = values.map(value => trayCritical(value.usage))
  const stableLabel = values.some(value => value.label !== undefined) ? '999M' : '0'.repeat(digits) + '%'
  const slot = ceilHalf(Math.max(measureText(stableLabel), ...labels.map(measureText)))
  const segWidth = iconBox + gapIconNum + slot
  const segments: TraySegmentLayout[] = values.map((value, index) => {
    const x = index * (segWidth + gapSeg)
    const numLeft = x + iconBox + gapIconNum
    return {
      providerId: value.providerId,
      usage: value.usage,
      active: value.active,
      critical: criticals[index]!,
      label: labels[index]!,
      x,
      iconX: x,
      numLeft,
      numCenterX: numLeft + slot / 2,
    }
  })
  const width = values.length === 0
    ? 0
    : values.length * segWidth + (values.length - 1) * gapSeg + edgeBleed
  return { width, height, digits, slotWidth: slot, segWidth, segments }
}
