import { useMemo, useState } from 'react'
import type { TableRow } from '@shared'
import { fmtCost, fmtCount, fmtDayLabel, fmtNum, fmtTokens } from '../lib/format'
import { modelColor, shortModel } from '../lib/colors'
import { Panel } from './ui'

type SortKey = 'label' | 'cost' | 'total' | 'count' | 'cacheSavings'
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

export function ExploreTable({ rows, granLabel, q }: { rows: TableRow[]; granLabel: string; q: string }) {
  const [sort, setSort] = useState<SortKey>('label')
  const [dir, setDir] = useState<Dir>('desc')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const handleSort = (key: SortKey) => {
    if (sort === key) setDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setDir('desc') }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    // Match against humanized + raw forms so typing "jun" or "opus" works.
    const base = s
      ? rows.filter(r => `${fmtDayLabel(r.label)} ${r.label} ${r.models.map(shortModel).join(' ')} ${r.models.join(' ')}`.toLowerCase().includes(s))
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
    <Panel title={`explore · ${granLabel}`} captureName="explore">
      <div className="max-h-[calc(100vh-240px)] overflow-auto">
        <table className="w-full max-w-[1100px] border-collapse text-xs">
          <colgroup>
            <col />
            <col style={{ width: '34%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '13%' }} />
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-10 bg-bg-1 text-[11px] shadow-[inset_0_-1px_0_var(--color-line)]">
              <th className="py-2 pr-3 text-left font-normal">
                <SortHeader sortKey="label" label={dateColLabel} align="text-left" sort={sort} dir={dir} onSort={handleSort} />
              </th>
              <th className="py-2 pr-3 text-left font-normal text-fg-faint">models</th>
              <th className="py-2 pr-3 font-normal">
                <SortHeader sortKey="total" label="tokens" sort={sort} dir={dir} onSort={handleSort} />
              </th>
              <th className="hidden py-2 pr-3 font-normal sm:table-cell">
                <SortHeader sortKey="cacheSavings" label="saved" sort={sort} dir={dir} onSort={handleSort} />
              </th>
              <th className="hidden py-2 pr-3 font-normal sm:table-cell">
                <SortHeader sortKey="count" label="calls" sort={sort} dir={dir} onSort={handleSort} />
              </th>
              <th className="py-2 font-normal">
                <SortHeader sortKey="cost" label="cost" sort={sort} dir={dir} onSort={handleSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-fg-faint">{q.trim() ? `no rows match “${q.trim()}”` : 'no usage in this range'}</td></tr>
            )}
            {filtered.map(r => (
              <FragmentRow key={r.label} row={r} isOpen={open.has(r.label)} onToggle={() => handleToggleOpen(r.label)} />
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 z-10 bg-bg-1 text-fg shadow-[inset_0_1px_0_var(--color-line)]">
                <td className="py-2 pr-3 font-display text-[11px] uppercase text-fg-dim" colSpan={2}>total · {filtered.length}</td>
                <td className="tnum py-2 pr-3 text-right">{fmtTokens(totals.total)}</td>
                <td className="tnum hidden py-2 pr-3 text-right text-positive sm:table-cell">{fmtCost(totals.cacheSavings)}</td>
                <td className="tnum hidden py-2 pr-3 text-right sm:table-cell">{fmtCount(totals.count)}</td>
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
      <tr
        className="cursor-pointer border-b border-line-faint transition hover:bg-bg-2/60"
        onClick={onToggle}
      >
        <td className="whitespace-nowrap py-2 pr-3">
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={e => { e.stopPropagation(); onToggle() }}
            className="flex items-center gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <span aria-hidden className={isOpen ? 'text-accent' : 'text-fg-faint'}>{isOpen ? '▾' : '▸'}</span>
            <span className="text-fg">{fmtDayLabel(row.label)}</span>
          </button>
        </td>
        <td className="py-2 pr-3 text-fg-dim">
          <span className="line-clamp-1">{row.models.map(shortModel).join(', ')}</span>
        </td>
        <td className="tnum py-2 pr-3 text-right text-fg">{fmtTokens(row.total)}</td>
        <td className="tnum hidden py-2 pr-3 text-right text-positive sm:table-cell">{fmtCost(row.cacheSavings)}</td>
        <td className="tnum hidden py-2 pr-3 text-right text-fg-dim sm:table-cell">{fmtCount(row.count)}</td>
        <td className="tnum py-2 text-right text-cost">{fmtCost(row.cost)}</td>
      </tr>
      {isOpen && row.breakdown.map(m => (
        <tr key={m.name} className="border-b border-line-faint bg-bg-0/40 text-[11px]">
          <td className="py-1.5 pr-3 pl-5 text-fg-dim" colSpan={2}>
            <span className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: modelColor(m.name) }} />
            {shortModel(m.name)}
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
