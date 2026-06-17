import { useState } from 'react'
import type { Derived } from '../../lib/derive'
import { fmtCost, fmtNum, fmtPct, fmtTokens } from '../../lib/format'
import { shortModel } from '../../lib/colors'
import { EmptyHint, Panel, Segmented, Sparkline } from '../ui'

type SortKey = 'cost' | 'tokens' | 'calls'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'cost', label: 'cost' },
  { value: 'tokens', label: 'tokens' },
  { value: 'calls', label: 'calls' },
]

// One template drives both the header and the rows so they can never drift.
const COLS = '1.75rem minmax(6rem,12rem) minmax(3.5rem,1fr) 3rem 5.5rem 5rem 5rem 5rem 4rem'

export function ModelLeaderboard({ derived, limit }: { derived: Derived; limit?: number }) {
  const [sort, setSort] = useState<SortKey>('cost')
  const sorted = [...derived.byModel].sort((a, b) => b[sort] - a[sort])
  const rows = limit ? sorted.slice(0, limit) : sorted

  return (
    <Panel
      title="model leaderboard"
      captureName="models"
      right={
        <Segmented
          options={SORT_OPTIONS}
          value={sort}
          onChange={setSort}
          size="xs"
          containerClassName="flex items-center gap-0.5"
          btnClassName="rounded px-1.5 py-0.5 text-[11px] transition"
        />
      }
    >
      {rows.length === 0 ? <EmptyHint>no models in range</EmptyHint> : (
        <div className="mt-6 flex flex-col">
          <div
            className="grid items-center gap-x-3 border-b border-line pb-1.5 font-display text-[10px] uppercase tracking-wide text-fg-faint"
            style={{ gridTemplateColumns: COLS }}
          >
            <span />
            <span />
            <span>share</span>
            <span className="text-right">%</span>
            <span className="text-right text-cost/70">cost</span>
            <span className="text-right">trend</span>
            <span className="hidden text-right lg:block">$/call</span>
            <span className="hidden text-right md:block">tokens</span>
            <span className="hidden text-right lg:block">calls</span>
          </div>
          {rows.map((m, i) => (
            <div
              key={m.model}
              className="grid items-center gap-x-3 border-b border-line-faint py-2 last:border-0"
              style={{ gridTemplateColumns: COLS }}
            >
              <span className="tnum text-xs text-fg-faint">#{i + 1}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: m.color }} />
                <span className="truncate text-fg" title={m.model}>{shortModel(m.model)}</span>
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-3">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, m.share * 100)}%`, minWidth: '2px', background: m.color }} />
              </div>
              <span className="tnum text-right text-[11px] text-fg-dim">{fmtPct(m.share)}</span>
              <span className="tnum text-right text-xs text-cost">{fmtCost(m.cost)}</span>
              <span className="overflow-hidden text-right"><Sparkline data={m.trend.slice(-30)} color={m.color} className="text-sm" /></span>
              <span className="tnum hidden text-right text-xs text-fg-dim lg:block">{fmtCost(m.calls ? m.cost / m.calls : 0)}</span>
              <span className="tnum hidden text-right text-xs text-fg-dim md:block">{fmtTokens(m.tokens)}</span>
              <span className="tnum hidden text-right text-xs text-fg-faint lg:block">{fmtNum(m.calls)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
