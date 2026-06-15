import { useState, useEffect, useRef } from 'react'
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
