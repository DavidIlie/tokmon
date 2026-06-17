import { useState } from 'react'
import type { Derived } from '../../lib/derive'
import { fmtCost, fmtNum, fmtPct, fmtTokens } from '../../lib/format'
import { shortModel } from '../../lib/colors'
import { EmptyHint, Panel, Segmented } from '../ui'

type SortKey = 'cost' | 'tokens' | 'calls'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'cost', label: 'cost' },
  { value: 'tokens', label: 'tokens' },
  { value: 'calls', label: 'calls' },
]

export function ModelLeaderboard({ derived, limit }: { derived: Derived; limit?: number }) {
  const [sort, setSort] = useState<SortKey>('cost')
  const sorted = [...derived.byModel].sort((a, b) => b[sort] - a[sort])
  const rows = limit ? sorted.slice(0, limit) : sorted
  const maxShare = Math.max(...rows.map(r => r.share), 0.0001)

  return (
    <Panel
      title="model leaderboard"
      captureName="models"
      right={<Segmented options={SORT_OPTIONS} value={sort} onChange={setSort} size="xs" containerClassName="flex items-center gap-0.5" btnClassName="rounded px-1.5 py-0.5 text-[11px] transition" />}
    >
      {rows.length === 0 ? <EmptyHint>no models in range</EmptyHint> : (
        <div className="mt-1 flex flex-col">
          {rows.map((m, i) => (
            <div
              key={m.model}
              className="grid items-center gap-x-3 border-b border-line-faint py-2 last:border-0"
              style={{ gridTemplateColumns: '1.75rem minmax(6rem,11rem) minmax(4rem,1fr) 3rem 5rem 4.5rem 3.5rem' }}
            >
              <span className="tnum text-xs text-fg-faint">#{i + 1}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: m.color }} />
                <span className="truncate text-fg" title={m.model}>{shortModel(m.model)}</span>
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-3">
                <div className="h-full rounded-full" style={{ width: `${(m.share / maxShare) * 100}%`, background: m.color }} />
              </div>
              <span className="tnum text-right text-[11px] text-fg-dim">{fmtPct(m.share)}</span>
              <span className="tnum text-right text-xs text-cost">{fmtCost(m.cost)}</span>
              <span className="tnum hidden text-right text-xs text-fg-dim md:inline">{fmtTokens(m.tokens)}</span>
              <span className="tnum hidden text-right text-xs text-fg-faint lg:inline">{fmtNum(m.calls)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
