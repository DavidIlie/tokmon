import { memo } from 'react'
import { Box, Text } from 'ink'
import * as fmt from '../format'
import { PROVIDERS } from '../providers'
import type { ProviderId } from '../providers/types'
import type { TableRow } from '../types'
import type { CursorModelSpend } from '../providers/cursor/composer'
import { ClickableBox } from './shared'
import { CaretText } from './settings'
import { glyphs } from '../glyphs'

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const TableProviderBar = memo(function TableProviderBar({ providers, active, onSelect }: {
  providers: ProviderId[]
  active: ProviderId | null
  onSelect: (p: ProviderId) => void
}) {
  return (
    <Box>
      <Text dimColor>provider  </Text>
      {providers.map(p => {
        const meta = PROVIDERS[p]
        return (
          <ClickableBox key={p} onClick={() => onSelect(p)} marginRight={1}>
            {p === active
              ? <Text bold color={meta.color} inverse> {meta.name} </Text>
              : <Text color={meta.color} dimColor> {meta.name} </Text>}
          </ClickableBox>
        )
      })}
      <Text dimColor>  p/P switch</Text>
    </Box>
  )
})

export const ControlBar = memo(function ControlBar({ views, period, sort, search, searchCaret, searching, showPeriod }: {
  views: readonly string[]
  period: number
  sort: string
  search: string
  searchCaret: number
  searching: boolean
  showPeriod: boolean
}) {
  return (
    <Box>
      {showPeriod && (
        <>
          {views.map((v, i) => (
            <Box key={v} marginRight={2}>
              {i === period ? <Text bold color="cyan">[{v}]</Text> : <Text dimColor>{v}</Text>}
            </Box>
          ))}
          <Text dimColor>  </Text>
        </>
      )}
      <Text dimColor>sort </Text><Text bold color="magenta">{sort}</Text>
      <Text dimColor>  o cycle  {glyphs().middot}  </Text>
      {searching
        ? <><Text dimColor>/</Text><CaretText value={search} caret={searchCaret} color="cyan" /></>
        : search
          ? <><Text dimColor>filter </Text><Text bold color="green">{search}</Text><Text dimColor> (/ edit {glyphs().middot} esc clear)</Text></>
          : <Text dimColor>/ filter</Text>}
    </Box>
  )
})

export const TokenTable = memo(function TokenTable({ rows, cursor, expanded, maxRows, cols, onRowClick }: {
  rows: TableRow[]
  cursor: number
  expanded: number
  maxRows: number
  cols: number
  onRowClick: (idx: number) => void
}) {
  if (rows.length === 0) return <Text dimColor>No usage in this period (or filtered out).</Text>

  const wide = cols > 90
  const base = wide
    ? { label: 12, input: 10, output: 10, cc: 14, cr: 12, total: 11, cost: 13 }
    : { label: 8, input: 7, output: 7, cc: 7, cr: 8, total: 0, cost: 11 }
  const fixed = base.label + base.input + base.output + base.cc + base.cr + base.total + base.cost
  const available = cols - fixed - 6
  const W = { ...base, models: Math.max(wide ? 22 : 14, available) }
  const lineW = W.label + W.models + W.input + W.output + W.cc + W.cr + W.total + W.cost

  const totals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0 }
  for (const r of rows) {
    totals.input += r.input; totals.output += r.output
    totals.cacheCreate += r.cacheCreate; totals.cacheRead += r.cacheRead; totals.cost += r.cost
  }

  const clampedCursor = Math.min(cursor, rows.length - 1)
  const scrollStart = Math.max(0, Math.min(clampedCursor - Math.floor(maxRows / 2), rows.length - maxRows))
  const visible = rows.slice(scrollStart, scrollStart + maxRows)

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>  {fmt.col('Date', W.label, 'left')}</Text>
        <Text bold>{fmt.col('Models', W.models, 'left')}</Text>
        <Text bold>{fmt.col('Input', W.input)}</Text>
        <Text bold>{fmt.col('Output', W.output)}</Text>
        <Text bold>{fmt.col(wide ? 'Cache Create' : 'CchCrt', W.cc)}</Text>
        <Text bold>{fmt.col(wide ? 'Cache Read' : 'CchRd', W.cr)}</Text>
        {W.total > 0 && <Text bold>{fmt.col('Total', W.total)}</Text>}
        <Text bold>{fmt.col('Cost', W.cost)}</Text>
      </Text>
      <Text dimColor>{glyphs().rule.repeat(lineW + 2)}</Text>
      {visible.map((r, vi) => {
        const idx = scrollStart + vi
        const selected = idx === clampedCursor
        return (
          <Box key={r.label} flexDirection="column">
            <ClickableBox onClick={() => onRowClick(idx)}>
              <Text inverse={selected}>
                <Text color={selected ? undefined : 'cyan'}>{selected ? `${glyphs().caretR} ` : '  '}{fmt.col(fmtLabel(r.label), W.label, 'left')}</Text>
                <Text dimColor={!selected}>{fmt.col(r.models.join(', '), W.models, 'left')}</Text>
                <Text>{fmt.col(fmt.tokens(r.input), W.input)}</Text>
                <Text>{fmt.col(fmt.tokens(r.output), W.output)}</Text>
                <Text>{fmt.col(fmt.tokens(r.cacheCreate), W.cc)}</Text>
                <Text>{fmt.col(fmt.tokens(r.cacheRead), W.cr)}</Text>
                {W.total > 0 && <Text>{fmt.col(fmt.tokens(r.total), W.total)}</Text>}
                <Text bold color={selected ? undefined : 'yellow'}>{fmt.col(fmt.currency(r.cost), W.cost)}</Text>
              </Text>
            </ClickableBox>
            {idx === expanded && <RowDetail row={r} indent={W.label + 2} />}
          </Box>
        )
      })}
      <Text dimColor>{glyphs().rule.repeat(lineW + 2)}</Text>
      <Text>
        <Text bold color="greenBright">  {fmt.col('Total', W.label, 'left')}</Text>
        <Text>{fmt.col('', W.models, 'left')}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.input), W.input)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.output), W.output)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.cacheCreate), W.cc)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.cacheRead), W.cr)}</Text>
        {W.total > 0 && <Text bold color="yellow">{fmt.col(fmt.tokens(totals.input + totals.output + totals.cacheCreate + totals.cacheRead), W.total)}</Text>}
        <Text bold color="yellowBright">{fmt.col(fmt.currency(totals.cost), W.cost)}</Text>
      </Text>
      <Box height={1} />
      <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} navigate  {glyphs().middot}  Enter detail  {glyphs().middot}  o sort  {glyphs().middot}  g/G top/bottom  {glyphs().middot}  {clampedCursor + 1}/{rows.length}</Text>
    </Box>
  )
})

function RowDetail({ row, indent }: { row: TableRow; indent: number }) {
  return (
    <Box flexDirection="column" paddingLeft={indent}>
      {row.breakdown.map((m, i) => (
        <Text key={m.name}>
          <Text dimColor>{i === row.breakdown.length - 1 ? glyphs().treeEnd : glyphs().treeMid} </Text>
          <Text bold>{fmt.col(m.name, 16, 'left')}</Text>
          <Text>{fmt.col(fmt.tokens(m.input), 8)} in  </Text>
          <Text>{fmt.col(fmt.tokens(m.output), 8)} out  </Text>
          <Text>{fmt.col(fmt.tokens(m.cacheCreate), 8)} cc  </Text>
          <Text>{fmt.col(fmt.tokens(m.cacheRead), 9)} cr  </Text>
          <Text bold color="yellow">{fmt.currency(m.cost)}</Text>
        </Text>
      ))}
    </Box>
  )
}

export const CursorSpendTable = memo(function CursorSpendTable({ rows, cursor, maxRows, onRowClick }: {
  rows: CursorModelSpend[]
  cursor: number
  maxRows: number
  onRowClick: (idx: number) => void
}) {
  if (rows.length === 0) return <Text dimColor>No Cursor spend recorded locally.</Text>

  const total = rows.reduce((a, r) => a + r.usd, 0)
  const totalAmt = rows.reduce((a, r) => a + r.requests, 0)
  const clamped = Math.min(cursor, rows.length - 1)
  const scrollStart = Math.max(0, Math.min(clamped - Math.floor(maxRows / 2), rows.length - maxRows))
  const visible = rows.slice(scrollStart, scrollStart + maxRows)
  const W = { model: 34, cost: 12, amount: 12, share: 8 }

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>  {fmt.col('Model', W.model, 'left')}</Text>
        <Text bold>{fmt.col('Cost', W.cost)}</Text>
        <Text bold>{fmt.col('Amount', W.amount)}</Text>
        <Text bold>{fmt.col('Share', W.share)}</Text>
      </Text>
      <Text dimColor>{glyphs().rule.repeat(W.model + W.cost + W.amount + W.share + 2)}</Text>
      {visible.map((r, vi) => {
        const idx = scrollStart + vi
        const selected = idx === clamped
        const share = total > 0 ? (r.usd / total) * 100 : 0
        return (
          <ClickableBox key={r.name} onClick={() => onRowClick(idx)}>
            <Text inverse={selected}>
              <Text color={selected ? undefined : 'magenta'}>{selected ? `${glyphs().caretR} ` : '  '}{fmt.col(r.name, W.model, 'left')}</Text>
              <Text bold color={selected ? undefined : 'yellow'}>{fmt.col(fmt.currency(r.usd), W.cost)}</Text>
              <Text>{fmt.col(fmt.tokens(r.requests), W.amount)}</Text>
              <Text dimColor>{fmt.col(share.toFixed(1) + '%', W.share)}</Text>
            </Text>
          </ClickableBox>
        )
      })}
      <Text dimColor>{glyphs().rule.repeat(W.model + W.cost + W.amount + W.share + 2)}</Text>
      <Text>
        <Text bold color="greenBright">  {fmt.col('Total', W.model, 'left')}</Text>
        <Text bold color="yellowBright">{fmt.col(fmt.currency(total), W.cost)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totalAmt), W.amount)}</Text>
        <Text dimColor>{fmt.col('100%', W.share)}</Text>
      </Text>
      <Box height={1} />
      <Text dimColor>local spend by model (composerData) {glyphs().middot} est. API-equivalent {glyphs().middot} {clamped + 1}/{rows.length}</Text>
    </Box>
  )
})

function fmtLabel(label: string): string {
  if (label.length === 7 && label[4] === '-') {
    return `${MONTHS[Number(label.slice(5, 7))]} '${label.slice(2, 4)}`
  }
  return fmt.shortDate(label)
}
