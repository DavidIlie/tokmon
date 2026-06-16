import { appendFileSync } from 'node:fs'
import { useEffect, useRef, useState } from 'react'
import { Box, Text, type DOMElement } from 'ink'
import { useOnMouseClick } from '@zenobius/ink-mouse'
import type { Metric } from '../providers/types'
import type { PeakStatus } from '../peak'
import { glyphs } from '../glyphs'

export function truncateName(s: string, n: number): string {
  const ell = glyphs().ellipsis
  return s.length > n ? s.slice(0, n - ell.length) + ell : s
}

export function ClickableBox(
  { onClick, children, ...props }: { onClick: () => void; children: React.ReactNode } & Record<string, unknown>,
) {
  const ref = useRef<DOMElement>(null)
  useOnMouseClick(ref, (clicked) => { if (clicked) onClick() })
  return <Box ref={ref} {...props}>{children}</Box>
}

// --- LinkBox click routing ---------------------------------------------------
// LinkBox does NOT use ink-mouse's click event for two reasons we verified:
//   1. ink-mouse's parser only recognizes button code 0 (plain left). macOS
//      Terminal.app forwards a click only while ⌥ Option is held, which arrives
//      with the meta modifier bit set (button 8) and never matches — so the
//      'click' event never fires there at all.
//   2. ink-mouse re-subscribes its click listener on every render, so a click
//      that lands mid-render can find no listener attached.
// Instead, App taps stdin ONCE (right where it enables mouse reporting, the only
// place a process.stdin 'data' listener reliably receives bytes — Ink v5 drains
// stdin via 'readable'+read(), so a listener added later sees nothing) and feeds
// each raw chunk to `dispatchLinkClicks` below, which hit-tests every mounted
// LinkBox. The keyboard shortcut (O) stays the universal fallback for terminals
// that forward no clicks at all.

// Match an SGR mouse report ending in `M` (press): ESC [ < <btn> ; <col> ; <row> M.
const SGR_PRESS = /\x1b\[<(\d+);(\d+);(\d+)M/g

type LinkHit = (mx: number, my: number) => boolean
const linkHits = new Set<LinkHit>()

/** Feed a raw stdin chunk; fire the onClick of every LinkBox whose glyphs the
 *  press lands on. Called once per chunk by App's stdin tap. */
export function dispatchLinkClicks(chunk: Buffer | string): void {
  if (linkHits.size === 0) return
  const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  SGR_PRESS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SGR_PRESS.exec(s)) !== null) {
    // Wheel reports carry bit 64, motion/drag bit 32 — neither is a click on a
    // link. Lower bits select the button; modifiers (4=shift, 8=meta/⌥, 16=ctrl)
    // are deliberately ignored so ⌥-click (the only click Terminal.app forwards)
    // still registers.
    const code = Number(m[1])
    if (code & 0x40 || code & 0x20) continue
    const mx = Number(m[2]) - 1   // SGR coords are 1-based; yoga is 0-based
    const my = Number(m[3]) - 1
    if (process.env.TOKMON_LINKDEBUG) { try { appendFileSync(process.env.TOKMON_LINKDEBUG, `DISPATCH code=${code} mx=${mx} my=${my} hits=${linkHits.size}\n`) } catch {} }
    for (const hit of [...linkHits]) {
      if (hit(mx, my)) break   // topmost match wins; don't double-fire siblings
    }
  }
}

/** Absolute (screen-space) box of a laid-out Ink node, or null if not yet laid
 *  out. Reads the live yoga layout on each call (walking parents to an absolute
 *  origin) so the hit zone is never a value cached stale at mount. */
function nodeBox(node: DOMElement | null): { left: number; top: number; width: number; height: number } | null {
  const yn = (node as { yogaNode?: { getComputedLayout(): { left: number; top: number; width: number; height: number } } } | null)?.yogaNode
  if (!yn) return null
  const l = yn.getComputedLayout()
  let left = l.left, top = l.top
  let p = (node as { parentNode?: DOMElement } | null)?.parentNode
  while (p) {
    const pn = (p as { yogaNode?: { getComputedLayout(): { left: number; top: number } } }).yogaNode
    if (!pn) break
    const pl = pn.getComputedLayout()
    left += pl.left; top += pl.top
    p = (p as { parentNode?: DOMElement }).parentNode
  }
  return { left, top, width: l.width, height: l.height }
}

export function LinkBox(
  { onClick, children, ...props }: { onClick: () => void; children: React.ReactNode } & Record<string, unknown>,
) {
  const ref = useRef<DOMElement>(null)
  const onClickRef = useRef(onClick); onClickRef.current = onClick

  useEffect(() => {
    const hit: LinkHit = (mx, my) => {
      const box = nodeBox(ref.current)   // live geometry — never stale
      if (process.env.TOKMON_LINKDEBUG) { try { appendFileSync(process.env.TOKMON_LINKDEBUG, `HIT? mx=${mx} my=${my} box=${box ? `${box.left},${box.top} ${box.width}x${box.height}` : 'null'}\n`) } catch {} }
      if (!box || box.width <= 0 || box.height <= 0) return false
      if (mx >= box.left && mx < box.left + box.width && my >= box.top && my < box.top + box.height) {
        onClickRef.current()
        return true
      }
      return false
    }
    linkHits.add(hit)
    return () => { linkHits.delete(hit) }
  }, [])

  return <Box ref={ref} {...props}>{children}</Box>
}

export function Spinner({ label }: { label: string }) {
  const frames = glyphs().spinner
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI(n => (n + 1) % frames.length), 80)
    return () => clearInterval(id)
  }, [])
  return (
    <Box>
      <Text color="green">{frames[i]} </Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}

export function TabBar(
  { tabs, active, onSelect }: { tabs: readonly string[]; active: number; onSelect: (i: number) => void },
) {
  return (
    <Box>
      {tabs.map((t, i) => (
        <ClickableBox key={t} onClick={() => onSelect(i)} marginRight={1}>
          {i === active ? <Text bold inverse> {t} </Text> : <Text dimColor> {t} </Text>}
        </ClickableBox>
      ))}
    </Box>
  )
}

export function PeakBadge({ peak }: { peak: PeakStatus }) {
  const color = peak.state === 'peak' ? 'red' : 'green'
  return (
    <Box>
      <Text color={color}>{glyphs().dot} </Text>
      <Text bold color={color}>{peak.label}</Text>
      {peak.minutesUntilChange !== null && peak.minutesUntilChange > 0 && (
        <Text dimColor> ({fmtMinutes(peak.minutesUntilChange)})</Text>
      )}
    </Box>
  )
}

function fmtMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function currencySymbol(cur?: string): string {
  return cur === 'EUR' ? glyphs().eur : cur === 'GBP' ? glyphs().gbp : '$'
}

/** Render values as a unicode sparkline; zero days keep a flat baseline. */
export function sparkline(values: number[]): string {
  if (values.length === 0) return ''
  const spark = glyphs().spark
  const max = Math.max(...values)
  if (max <= 0) return spark[0].repeat(values.length)
  return values.map(v => {
    if (v <= 0) return spark[0]
    const idx = Math.min(spark.length - 1, 1 + Math.round((v / max) * (spark.length - 2)))
    return spark[idx]
  }).join('')
}

/** Bar for a percentage value, color-graded by utilization. */
export function Bar({ pct, color, width = 24 }: { pct: number; color: string; width?: number }) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return (
    <Text>
      <Text color={color}>{glyphs().barFull.repeat(filled)}</Text>
      <Text dimColor>{glyphs().barEmpty.repeat(width - filled)}</Text>
    </Text>
  )
}

/** Non-percent metric value as a string (dollars / counts). */
export function metricValueText(m: Metric): string {
  if (m.format.kind === 'dollars') {
    const sym = currencySymbol(m.format.currency)
    const used = `${sym}${m.used.toFixed(2)}`
    return m.limit != null ? `${used} / ${sym}${m.limit.toFixed(2)}` : `${used}`
  }
  if (m.format.kind === 'count') {
    const suffix = m.format.suffix ? ` ${m.format.suffix}` : ''
    const used = `${Math.round(m.used)}${suffix}`
    return m.limit != null ? `${used} / ${Math.round(m.limit)}` : used
  }
  return `${Math.round(m.used)}%`
}
