import { Fragment, useMemo, useState } from 'react'
import type { TableRow } from '@shared'
import {
  createColumnHelper, flexRender, getCoreRowModel, getExpandedRowModel,
  getFilteredRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type ExpandedState, type SortingState,
} from '@tanstack/react-table'
import { fmtCost, fmtCount, fmtDayLabel, fmtNum, fmtTokens, sumTokens } from '../lib/format'
import { modelColor, shortModel } from '../lib/colors'
import { Panel } from './ui/panel'

type Meta = { align?: 'right'; hiddenSm?: boolean }
const col = createColumnHelper<TableRow>()
const dash = <span className="text-fg-faint">—</span>
const haystack = (r: TableRow) =>
  `${fmtDayLabel(r.label)} ${r.label} ${r.models.map(shortModel).join(' ')} ${r.models.join(' ')}`.toLowerCase()

function useColumns(dateLabel: string): ColumnDef<TableRow, any>[] {
  return useMemo(() => [
    col.accessor('label', {
      header: dateLabel,
      cell: info => (
        <button
          type="button"
          aria-expanded={info.row.getIsExpanded()}
          onClick={e => { e.stopPropagation(); info.row.toggleExpanded() }}
          className="flex items-center gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <span aria-hidden className={info.row.getIsExpanded() ? 'text-accent' : 'text-fg-faint'}>{info.row.getIsExpanded() ? '▾' : '▸'}</span>
          <span className="text-fg">{fmtDayLabel(info.getValue() as string)}</span>
        </button>
      ),
    }),
    col.display({ id: 'models', header: 'models', cell: info => <span className="line-clamp-1 text-fg-dim">{info.row.original.models.map(shortModel).join(', ')}</span> }),
    col.accessor('total', { header: 'tokens', meta: { align: 'right' } satisfies Meta, cell: info => (info.getValue() as number) > 0 ? <span className="text-fg">{fmtTokens(info.getValue() as number)}</span> : dash }),
    col.accessor('cacheSavings', { header: 'saved', meta: { align: 'right', hiddenSm: true } satisfies Meta, cell: info => <span className="text-positive">{fmtCost(info.getValue() as number)}</span> }),
    col.accessor('count', { header: 'calls', meta: { align: 'right', hiddenSm: true } satisfies Meta, cell: info => <span className="text-fg-dim">{fmtCount(info.getValue() as number)}</span> }),
    col.accessor('cost', { header: 'cost', meta: { align: 'right' } satisfies Meta, cell: info => <span className="text-cost">{fmtCost(info.getValue() as number)}</span> }),
  ], [dateLabel])
}

const cellPad = (meta: Meta | undefined) => `py-2 pr-3${meta?.align === 'right' ? ' text-right' : ''}${meta?.hiddenSm ? ' hidden sm:table-cell' : ''}`

export function ExploreTable({ rows, granLabel, q }: { rows: TableRow[]; granLabel: string; q: string }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'label', desc: true }])
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const dateColLabel = granLabel === 'monthly' ? 'month' : granLabel === 'weekly' ? 'week' : 'date'
  const columns = useColumns(dateColLabel)

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, expanded, globalFilter: q },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getRowCanExpand: () => true,
    globalFilterFn: (row, _id, filter) => !String(filter).trim() || haystack(row.original).includes(String(filter).trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })

  const visible = table.getRowModel().rows
  const totals = useMemo(() => visible.reduce((t, r) => ({
    total: t.total + r.original.total, cost: t.cost + r.original.cost,
    cacheSavings: t.cacheSavings + r.original.cacheSavings, count: t.count + r.original.count,
  }), { total: 0, cost: 0, cacheSavings: 0, count: 0 }), [visible])

  return (
    <Panel title={`explore · ${granLabel}`} captureName="explore">
      <div className="max-h-[calc(100vh-240px)] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <colgroup>
            <col /><col style={{ width: '34%' }} /><col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} />
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-10 bg-bg-1 text-[11px] shadow-[inset_0_-1px_0_var(--color-line)]">
              {table.getHeaderGroups()[0].headers.map(h => {
                const meta = h.column.columnDef.meta as Meta | undefined
                const sorted = h.column.getIsSorted()
                return (
                  <th key={h.id} className={`py-2 pr-3 font-normal ${meta?.align === 'right' ? 'text-right' : 'text-left'}${meta?.hiddenSm ? ' hidden sm:table-cell' : ''}`}>
                    {h.column.getCanSort() ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className={`flex w-full items-center gap-1 text-fg-faint transition hover:text-fg ${meta?.align === 'right' ? 'justify-end' : ''}`}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted && <span className="text-accent">{sorted === 'asc' ? '▲' : '▼'}</span>}
                      </button>
                    ) : <span className="text-fg-faint">{flexRender(h.column.columnDef.header, h.getContext())}</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-fg-faint">{q.trim() ? `no rows match “${q.trim()}”` : 'no usage in this range'}</td></tr>
            )}
            {visible.map(row => (
              <Fragment key={row.id}>
                <tr className="cursor-pointer border-b border-line-faint transition hover:bg-bg-2/60" onClick={() => row.toggleExpanded()}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className={`${cellPad(cell.column.columnDef.meta as Meta | undefined)}${cell.column.id === 'label' ? ' whitespace-nowrap' : ''} tnum`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {row.getIsExpanded() && row.original.breakdown.map(m => {
                  const tok = sumTokens(m)
                  return (
                    <tr key={m.name} className="border-b border-line-faint bg-bg-0/40 text-[11px]">
                      <td className="py-1.5 pr-3 pl-5 text-fg-dim" colSpan={2}>
                        <span className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: modelColor(m.name) }} />
                        {shortModel(m.name)}
                      </td>
                      <td className="tnum py-1.5 pr-3 text-right text-fg-dim">{tok > 0 ? fmtTokens(tok) : dash}</td>
                      <td className="tnum hidden py-1.5 pr-3 text-right text-positive/80 sm:table-cell">{fmtCost(m.cacheSavings)}</td>
                      <td className="tnum hidden py-1.5 pr-3 text-right text-fg-faint sm:table-cell">{fmtNum(m.count)}</td>
                      <td className="tnum py-1.5 text-right text-cost/90">{fmtCost(m.cost)}</td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 z-10 bg-bg-1 text-fg shadow-[inset_0_1px_0_var(--color-line)]">
                <td className="py-2 pr-3 font-display text-[11px] uppercase text-fg-dim" colSpan={2}>total · {visible.length}</td>
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
