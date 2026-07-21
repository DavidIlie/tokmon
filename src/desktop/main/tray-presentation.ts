export interface TrayIconSpec {
  pointSize: number
  scaleFactors: readonly number[]
  tickCount: number
  litTicks: number
  unlitOpacity: number
  critical: boolean
  available: boolean
}

export function trayIconSpec(usedPct: number | null, critical: boolean): TrayIconSpec {
  const used = usedPct === null || !Number.isFinite(usedPct)
    ? null
    : Math.max(0, Math.min(100, usedPct))
  return {
    pointSize: 16,
    scaleFactors: [1, 2],
    tickCount: 12,
    litTicks: used === null ? 0 : Math.round(used / 100 * 12),
    unlitOpacity: 0.45,
    critical,
    available: used !== null,
  }
}

/**
 * The single-icon fallback title (used only when nothing is pinned). Usage is
 * carried by the ring geometry and the wording lives in the tooltip; the strip
 * never prefixes "!" — urgency is shape, not punctuation.
 */
export function menuBarTitle(
  showText: boolean,
  usedPct: number | null,
  _critical: boolean,
  alternate?: string,
): string {
  if (!showText) return ''
  if (alternate !== undefined) return alternate
  if (usedPct === null || !Number.isFinite(usedPct)) return ''
  const bounded = Math.max(0, Math.min(100, usedPct))
  const used = bounded > 0 && bounded < 1 ? '<1' : String(Math.round(bounded))
  return `${used}%`
}

/** Disconnected state is conveyed by the icon's critical ring + tooltip words, not "!". */
export function disconnectedMenuBarTitle(_error: boolean): string {
  return ''
}
