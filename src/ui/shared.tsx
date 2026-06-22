import { appendFileSync } from 'node:fs'
import { memo, useEffect, useRef, useState } from 'react'
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


const SGR_PRESS = /\x1b\[<(\d+);(\d+);(\d+)M/g

type LinkHit = (mx: number, my: number) => boolean
const linkHits = new Set<LinkHit>()

export function dispatchLinkClicks(chunk: Buffer | string): void {
  if (linkHits.size === 0) return
  const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  SGR_PRESS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SGR_PRESS.exec(s)) !== null) {
    const code = Number(m[1])
    if (code & 0x40 || code & 0x20) continue
    const mx = Number(m[2]) - 1
    const my = Number(m[3]) - 1
    if (process.env.TOKMON_LINKDEBUG) { try { appendFileSync(process.env.TOKMON_LINKDEBUG, `DISPATCH code=${code} mx=${mx} my=${my} hits=${linkHits.size}\n`) } catch {} }
    for (const hit of [...linkHits]) {
      if (hit(mx, my)) break
    }
  }
}

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
      const box = nodeBox(ref.current)
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

export const TabBar = memo(function TabBar(
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
})

export const PeakBadge = memo(function PeakBadge({ peak }: { peak: PeakStatus }) {
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
})

function fmtMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function currencySymbol(cur?: string): string {
  return cur === 'EUR' ? glyphs().eur : cur === 'GBP' ? glyphs().gbp : '$'
}

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

export function Bar({ pct, color, width = 24 }: { pct: number; color: string; width?: number }) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return (
    <Text>
      <Text color={color}>{glyphs().barFull.repeat(filled)}</Text>
      <Text dimColor>{glyphs().barEmpty.repeat(width - filled)}</Text>
    </Text>
  )
}

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
