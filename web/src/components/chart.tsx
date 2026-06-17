import type { ReactNode } from 'react'
import { fmtDayLabel } from '../lib/format'

export const AXIS = {
  tick: { fill: 'var(--color-fg-dim)', fontSize: 10, fontFamily: 'var(--font-mono)' },
  tickLine: false,
  axisLine: { stroke: 'var(--color-line)' },
} as const

export const GRID = {
  stroke: 'var(--color-line)',
  strokeDasharray: '2 5',
  vertical: false,
} as const

export const CURSOR = { stroke: 'var(--color-line-2)', strokeDasharray: '3 3' } as const

export interface TipRow {
  label: string
  value: string
  color?: string
}

type TipPayloadItem = {
  name?: string
  value?: number
  color?: string
  dataKey?: string
  payload?: Record<string, unknown>
}

export function makeTooltip(
  rows: (payload: ReadonlyArray<TipPayloadItem>, label: string) => TipRow[],
  opts: { title?: (label: string) => string } = {},
) {
  return function TerminalTooltip(props: { active?: boolean; payload?: unknown; label?: string | number }) {
    const { active, payload, label } = props as {
      active?: boolean
      payload?: ReadonlyArray<TipPayloadItem>
      label?: string | number
    }
    if (!active || !payload || payload.length === 0) return null
    const lbl = String(label ?? '')
    const built = rows(payload, lbl)
    if (built.length === 0) return null
    return (
      <div className="rounded-md border border-line-2 bg-bg-2/95 px-2.5 py-2 font-mono text-[11px] shadow-lg backdrop-blur">
        <div className="mb-1 text-fg-faint">{opts.title ? opts.title(lbl) : fmtDayLabel(lbl)}</div>
        <div className="flex flex-col gap-0.5">
          {built.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-fg-dim">
                {r.color && <span className="inline-block size-2 rounded-[2px]" style={{ background: r.color }} />}
                {r.label}
              </span>
              <span className="tnum text-fg-bright">{r.value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
}

export function ChartShell({ height = 240, children }: { height?: number; children: ReactNode }) {
  return <div style={{ height, width: '100%' }}>{children}</div>
}
