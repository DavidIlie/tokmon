import type { ReactNode } from 'react'

export function PromptHeader({ label, crumb }: { label: string; crumb?: string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-prompt">$</span>
      {crumb && <span className="text-fg-faint">{crumb}</span>}
      <span className="text-fg-bright">{label}</span>
      <span className="cursor-blink text-accent">▋</span>
    </div>
  )
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export function Sparkline({ data, color = 'var(--color-accent)', className = '' }: {
  data: number[]
  color?: string
  className?: string
}) {
  const TOP = SPARK.length - 1
  const max = Math.max(...data, 0)
  const min = Math.min(...data, 0)
  const flat = max > 0 && min === max
  return (
    <span className={`font-mono leading-none ${className}`} style={{ color }} aria-hidden>
      {data.length === 0
        ? '·'
        : flat
          ? SPARK[Math.floor(TOP / 2)].repeat(data.length)
          : data.map(v => SPARK[max <= 0 ? 0 : Math.max(0, Math.min(TOP, Math.floor((v / max) * (TOP + 0.999))))]).join('')}
    </span>
  )
}

export function Delta({ value, positiveIsGood = false }: { value: number; positiveIsGood?: boolean }) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.001) return <span className="text-fg-faint text-xs">—</span>
  const up = value > 0
  const good = positiveIsGood ? up : !up
  return (
    <span className={`text-xs tnum ${good ? 'text-positive' : 'text-warning'}`}>
      {up ? '▲' : '▼'} {Math.abs(value * 100).toFixed(0)}%
    </span>
  )
}

export function StatBlock({ label, value, sub, valueClass = 'text-fg-bright' }: {
  label: string
  value: ReactNode
  sub?: ReactNode
  valueClass?: string
}) {
  return (
    <div>
      <div className="font-display text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`tnum mt-1 text-xl ${valueClass}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-xs text-fg-dim">{sub}</div>}
    </div>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center text-center text-xs text-fg-faint">
      {children}
    </div>
  )
}
