import { useMemo, useState } from 'react'
import type { TableRow } from '@shared'
import { fmtCost, fmtDayLabel, fmtNum, fmtTokens } from '../lib/format'
import { shortModel } from '../lib/colors'
import { Search, X } from './icons'
import { Panel } from './ui'

type SortKey = 'label' | 'cost' | 'total' | 'count'
type Dir = 'asc' | 'desc'

function SortHeader({ sortKey, label, align = 'text-right', sort, dir, onSort }: {
  sortKey: SortKey
  label: string
  align?: string
  sort: SortKey
  dir: Dir
  onSort: (key: SortKey) => void
}) {
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex w-full items-center gap-1 ${align === 'text-right' ? 'justify-end' : ''} text-fg-faint transition hover:text-fg`}
    >
      {label}
      {sort === sortKey && <span className="text-accent">{dir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  )
}

export function ExploreTable({ rows, granLabel }: { rows: TableRow[]; granLabel: string }) {
  const [sort, setSort] = useState<SortKey>('label')
  const [dir, setDir] = useState<Dir>('desc')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const handleSort = (key: SortKey) => {
    if (sort === key) setDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setDir('desc') }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = s
      ? rows.filter(r => r.label.toLowerCase().includes(s) || r.models.some(m => m.toLowerCase().includes(s)))
      : rows
    return [...base].sort((a, b) => {
      const av = sort === 'label' ? a.label : a[sort]
      const bv = sort === 'label' ? b.label : b[sort]
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return dir === 'asc' ? cmp : -cmp
    })
  }, [rows, q, sort, dir])

  const totals = useMemo(() => filtered.reduce((t, r) => ({
    total: t.total + r.total,
    cost: t.cost + r.cost,
    cacheSavings: t.cacheSavings + r.cacheSavings,
    count: t.count + r.count,
  }), { total: 0, cost: 0, cacheSavings: 0, count: 0 }), [filtered])

  const handleToggleOpen = (label: string) => setOpen(prev => {
    const next = new Set(prev)
    next.has(label) ? next.delete(label) : next.add(label)
    return next
  })

  const dateColLabel = granLabel === 'monthly' ? 'month' : granLabel === 'weekly' ? 'week' : 'date'

  return (
    <Panel
      title={`explore · ${granLabel}`}
      captureName="explore"
      right={
        <div className="flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2 py-0.5 text-xs">
          <Search className="size-3 text-fg-faint" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="filter…"
            className="w-24 bg-transparent text-fg outline-none placeholder:text-fg-faint"
          />
          {q && <button onClick={() => setQ('')}><X className="size-3 text-fg-faint hover:text-fg" /></button>}
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-line text-[11px]">
              <th className="py-2 pr-3 text-left font-normal" style={{ width: '1%' }}>
                <SortHeader sortKey="label" label={dateColLabel} align="text-left" sort={sort} dir={dir} onSort={handleSort} />
              </th>
              <th className="py-2 pr-3 text-left font-normal text-fg-faint">models</th>
              <th className="py-2 pr-3 font-normal">
                <SortHeader sortKey="total" label="tokens" sort={sort} dir={dir} onSort={handleSort} />
              </th>
              <th className="py-2 pr-3 font-normal text-fg-faint"><span className="block text-right">saved</span></th>
              <th className="py-2 pr-3 font-normal">
                <SortHeader sortKey="count" label="calls" sort={sort} dir={dir} onSort={handleSort} />
              </th>
              <th className="py-2 font-normal">
                <SortHeader sortKey="cost" label="cost" sort={sort} dir={dir} onSort={handleSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-fg-faint">no rows match</td></tr>
            )}
            {filtered.map(r => (
              <FragmentRow key={r.label} row={r} isOpen={open.has(r.label)} onToggle={() => handleToggleOpen(r.label)} />
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t border-line text-fg">
                <td className="py-2 pr-3 font-display text-[11px] uppercase text-fg-dim" colSpan={2}>total · {filtered.length}</td>
                <td className="tnum py-2 pr-3 text-right">{fmtTokens(totals.total)}</td>
                <td className="tnum py-2 pr-3 text-right text-positive">{fmtCost(totals.cacheSavings)}</td>
                <td className="tnum py-2 pr-3 text-right">{fmtNum(totals.count)}</td>
                <td className="tnum py-2 text-right text-cost">{fmtCost(totals.cost)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Panel>
  )
}

function FragmentRow({ row, isOpen, onToggle }: { row: TableRow; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-b border-line-faint transition hover:bg-bg-2/60" onClick={onToggle}>
        <td className="whitespace-nowrap py-2 pr-3">
          <span className="text-fg-faint">{isOpen ? '▾' : '▸'}</span>{' '}
          <span className="text-fg">{fmtDayLabel(row.label)}</span>
        </td>
        <td className="py-2 pr-3 text-fg-dim">
          <span className="line-clamp-1">{row.models.map(shortModel).join(', ')}</span>
        </td>
        <td className="tnum py-2 pr-3 text-right text-fg">{fmtTokens(row.total)}</td>
        <td className="tnum py-2 pr-3 text-right text-positive">{fmtCost(row.cacheSavings)}</td>
        <td className="tnum py-2 pr-3 text-right text-fg-dim">{fmtNum(row.count)}</td>
        <td className="tnum py-2 text-right text-cost">{fmtCost(row.cost)}</td>
      </tr>
      {isOpen && row.breakdown.map(m => (
        <tr key={m.name} className="border-b border-line-faint bg-bg-0/40 text-[11px]">
          <td className="py-1.5 pr-3 pl-5 text-fg-dim" colSpan={2}>
            <span className="text-fg-faint">└ </span>{shortModel(m.name)}
          </td>
          <td className="tnum py-1.5 pr-3 text-right text-fg-dim">{fmtTokens(m.input + m.output + m.cacheCreate + m.cacheRead)}</td>
          <td className="tnum py-1.5 pr-3 text-right text-positive/80">{fmtCost(m.cacheSavings)}</td>
          <td className="tnum py-1.5 pr-3 text-right text-fg-faint">{fmtNum(m.count)}</td>
          <td className="tnum py-1.5 text-right text-cost/90">{fmtCost(m.cost)}</td>
        </tr>
      ))}
    </>
  )
}
