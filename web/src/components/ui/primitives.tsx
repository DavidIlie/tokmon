import type { ReactNode } from 'react'

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
