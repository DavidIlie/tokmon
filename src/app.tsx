import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useInput, useStdout, useApp, type DOMElement } from 'ink'
import { useMouse, useOnMouseClick } from '@zenobius/ink-mouse'
import { fetchDashboard, fetchTable, type DashboardData, type TableData } from './data'
import { fetchBilling, type BillingData } from './billing'
import { loadConfig, saveConfig, configLocation, type Config } from './config'
import * as fmt from './format'
import type { UsageSummary, TableRow } from './types'

const TABS = ['Dashboard', 'Table'] as const
const VIEWS = ['Daily', 'Weekly', 'Monthly'] as const
const SORTS = ['date ↑', 'date ↓', 'cost ↑', 'cost ↓'] as const
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DEFAULT_CONFIG: Config = { interval: 2, billingInterval: 5, clearScreen: true }
const IS_TTY = process.stdin.isTTY === true

export function App({ interval: cliInterval }: { interval?: number }) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [billing, setBilling] = useState<BillingData | null>(null)
  const [table, setTable] = useState<TableData | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(new Date())
  const [tab, setTab] = useState(0)
  const [view, setView] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [expanded, setExpanded] = useState(-1)
  const [sort, setSort] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [settingsCursor, setSettingsCursor] = useState(0)
  const tableLoadedOnce = useRef(false)
  const { stdout } = useStdout()
  const { exit } = useApp()
  const rows = stdout?.rows ?? 24
  const cols = stdout?.columns ?? 80
  const interval = cliInterval ?? (config?.interval ?? 2) * 1000
  const cfg = config ?? DEFAULT_CONFIG

  useEffect(() => {
    loadConfig().then(c => {
      if (cliInterval) c = { ...c, interval: cliInterval / 1000 }
      setConfig(c)
    })
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await fetchDashboard()
        if (active) { setDashboard(result); setError(null); setUpdated(new Date()) }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const id = setInterval(load, interval)
    return () => { active = false; clearInterval(id) }
  }, [interval])

  const billingMs = cfg.billingInterval * 60_000

  useEffect(() => {
    let active = true
    const load = () => fetchBilling().then(b => { if (active) setBilling(b) }).catch(() => {})
    load()
    const id = setInterval(load, billingMs)
    return () => { active = false; clearInterval(id) }
  }, [billingMs])

  useEffect(() => {
    if (tab !== 1) return
    if (tableLoadedOnce.current && table) return
    let active = true
    setTableLoading(true)
    fetchTable().then(result => {
      if (active) { setTable(result); setTableLoading(false); tableLoadedOnce.current = true }
    }).catch(() => { if (active) setTableLoading(false) })
    return () => { active = false }
  }, [tab])

  useEffect(() => {
    if (tab !== 1 || !tableLoadedOnce.current) return
    let active = true
    const id = setInterval(async () => {
      try {
        const result = await fetchTable()
        if (active) setTable(result)
      } catch {}
    }, Math.max(interval, 10000))
    return () => { active = false; clearInterval(id) }
  }, [tab, interval])

  const resetView = useCallback(() => {
    setCursor(0)
    setExpanded(-1)
  }, [])

  const mouse = useMouse()

  useEffect(() => {
    if (!IS_TTY) return
    mouse.enable()
    const onScroll = (_pos: { x: number; y: number }, dir: string | null) => {
      if (tab === 1) {
        setCursor(c => dir === 'scrollup' ? Math.max(0, c - 3) : c + 3)
      }
    }
    mouse.events.on('scroll', onScroll)
    return () => { mouse.events.off('scroll', onScroll) }
  }, [tab])

  useInput((input, key) => {
    if (showSettings) {
      if (key.escape || input === 's') setShowSettings(false)
      if (key.upArrow) setSettingsCursor(c => Math.max(0, c - 1))
      if (key.downArrow) setSettingsCursor(c => Math.min(2, c + 1))
      if (settingsCursor === 0) {
        if (key.leftArrow) updateConfig(c => ({ ...c, interval: Math.max(1, c.interval - 1) }))
        if (key.rightArrow) updateConfig(c => ({ ...c, interval: c.interval + 1 }))
      }
      if (settingsCursor === 1) {
        if (key.leftArrow) updateConfig(c => ({ ...c, billingInterval: Math.max(1, c.billingInterval - 1) }))
        if (key.rightArrow) updateConfig(c => ({ ...c, billingInterval: c.billingInterval + 1 }))
      }
      if (settingsCursor === 2 && (key.leftArrow || key.rightArrow || key.return)) {
        updateConfig(c => ({ ...c, clearScreen: !c.clearScreen }))
      }
      return
    }

    if (input === 'q') { exit(); return }
    if (input === 's') { setShowSettings(true); return }
    if (key.tab) { setTab(t => (t + 1) % TABS.length); resetView(); return }
    if (input === '1') { setTab(0); resetView(); return }
    if (input === '2') { setTab(1); resetView(); return }

    if (tab === 1) {
      if (input === 'd') { setView(0); resetView(); return }
      if (input === 'w') { setView(1); resetView(); return }
      if (input === 'm') { setView(2); resetView(); return }
      if (key.leftArrow) { setView(v => (v - 1 + VIEWS.length) % VIEWS.length); resetView(); return }
      if (key.rightArrow) { setView(v => (v + 1) % VIEWS.length); resetView(); return }
      if (input === 'o') { setSort(s => (s + 1) % SORTS.length); resetView(); return }
      if (key.return) { setExpanded(e => e === cursor ? -1 : cursor); return }
      if (key.escape) { setExpanded(-1); return }
    } else {
      if (key.leftArrow || key.rightArrow) { setTab(t => (t + 1) % TABS.length); resetView(); return }
    }

    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => c + 1); return }
    if (key.pageDown || input === 'G') { setCursor(c => input === 'G' ? 99999 : c + Math.max(1, rows - 12)); return }
    if (key.pageUp || input === 'g') { setCursor(c => input === 'g' ? 0 : Math.max(0, c - Math.max(1, rows - 12))); return }
  }, { isActive: IS_TTY })

  function updateConfig(fn: (prev: Config) => Config): void {
    setConfig(prev => {
      const next = fn(prev ?? DEFAULT_CONFIG)
      saveConfig(next)
      return next
    })
  }

  if (error) return <Box padding={1}><Text color="red">{error}</Text></Box>
  if (!dashboard) return <Box padding={1}><Text dimColor>Loading...</Text></Box>

  const rawTableData = table ? [table.daily, table.weekly, table.monthly][view] : []
  const tableData = sortRows(rawTableData, sort)

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} height={rows}>
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="greenBright">{'◉'} tokmon</Text>
          <Text dimColor>  ·  every {cliInterval ? cliInterval / 1000 : cfg.interval}s</Text>
        </Box>
        <Text dimColor>{fmt.time(updated)}</Text>
      </Box>

      {showSettings ? (
        <SettingsView config={cfg} cursor={settingsCursor} />
      ) : (
        <>
          <Box marginTop={1}>
            <TabBar tabs={TABS} active={tab} onSelect={(i) => { setTab(i); resetView() }} />
            <Text dimColor>  Tab/←→</Text>
          </Box>
          <Box height={1} />
          {tab === 0 && <DashboardView data={dashboard} billing={billing} />}
          {tab === 1 && (
            <>
              <ViewBar views={VIEWS} active={view} sort={SORTS[sort]} onSelect={(i) => { setView(i); resetView() }} />
              <Box height={1} />
              {tableLoading && !table
                ? <Spinner label="Loading 6 months of history" />
                : <TableView rows={tableData} cursor={cursor} expanded={expanded} maxRows={rows - 12} wide={cols > 90}
                    onRowClick={(idx) => {
                      if (idx === cursor) setExpanded(e => e === idx ? -1 : idx)
                      else setCursor(idx)
                    }}
                  />
              }
            </>
          )}
        </>
      )}

      {(tab === 0 || showSettings) && <Footer />}
    </Box>
  )
}

function Footer() {
  return (
    <Box marginTop={1}>
      <Text dimColor>by </Text>
      <Text>David Ilie</Text>
      <Text dimColor> (</Text>
      <Text color="cyan">davidilie.com</Text>
      <Text dimColor>)  ·  s=settings  q=quit</Text>
    </Box>
  )
}

function TabBar({ tabs, active, onSelect }: { tabs: readonly string[]; active: number; onSelect: (i: number) => void }) {
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

function ViewBar({ views, active, sort, onSelect }: { views: readonly string[]; active: number; sort: string; onSelect: (i: number) => void }) {
  return (
    <Box>
      {views.map((v, i) => (
        <ClickableBox key={v} onClick={() => onSelect(i)} marginRight={2}>
          {i === active ? <Text bold color="cyan">[{v}]</Text> : <Text dimColor>{v}</Text>}
        </ClickableBox>
      ))}
      <Text dimColor>  sort: </Text>
      <Text bold color="magenta">{sort}</Text>
      <Text dimColor>  o=cycle</Text>
    </Box>
  )
}

function sortRows(rows: TableRow[], sortIdx: number): TableRow[] {
  if (rows.length === 0) return rows
  const sorted = [...rows]
  switch (sortIdx) {
    case 0: return sorted.sort((a, b) => a.label.localeCompare(b.label))
    case 1: return sorted.sort((a, b) => b.label.localeCompare(a.label))
    case 2: return sorted.sort((a, b) => a.cost - b.cost)
    case 3: return sorted.sort((a, b) => b.cost - a.cost)
    default: return sorted
  }
}

function SettingsView({ config, cursor }: { config: Config; cursor: number }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Settings</Text>
      <Text dimColor>{configLocation()}</Text>
      <Box height={1} />
      <Box>
        <Text color={cursor === 0 ? 'green' : undefined}>{cursor === 0 ? '▸' : ' '} </Text>
        <Text>Refresh interval    </Text>
        <Text dimColor>{'◂'} </Text>
        <Text bold color="yellow">{config.interval}s</Text>
        <Text dimColor> {'▸'}</Text>
      </Box>
      <Box>
        <Text color={cursor === 1 ? 'green' : undefined}>{cursor === 1 ? '▸' : ' '} </Text>
        <Text>Billing poll        </Text>
        <Text dimColor>{'◂'} </Text>
        <Text bold color="yellow">{config.billingInterval}m</Text>
        <Text dimColor> {'▸'}</Text>
      </Box>
      <Box>
        <Text color={cursor === 2 ? 'green' : undefined}>{cursor === 2 ? '▸' : ' '} </Text>
        <Text>Clear screen        </Text>
        <Text bold color={config.clearScreen ? 'green' : 'red'}>{config.clearScreen ? 'on' : 'off'}</Text>
      </Box>
      <Box height={1} />
      <Text dimColor>↑↓ select  ←→ adjust  s/Esc close</Text>
    </Box>
  )
}

function DashboardView({ data, billing }: { data: DashboardData; billing: BillingData | null }) {
  return (
    <>
      <Box
        flexDirection="column"
        paddingLeft={1}
        borderStyle="bold"
        borderColor="green"
        borderRight={false}
        borderTop={false}
        borderBottom={false}
      >
        <Text bold>Claude</Text>
        <Box height={1} />
        <SummaryRow label="Today" summary={data.today} />
        <SummaryRow label="This Week" summary={data.week} />
        <SummaryRow label="This Month" summary={data.month} />
        {data.burnRate > 0 && (
          <>
            <Box height={1} />
            <Box>
              <Box width={14}><Text dimColor>Burn rate</Text></Box>
              <Box width={12} justifyContent="flex-end"><Text color="red">{fmt.currency(data.burnRate)}</Text></Box>
              <Text dimColor>/hr</Text>
            </Box>
          </>
        )}
      </Box>

      <Box height={1} />
      <Box
        flexDirection="column"
        paddingLeft={1}
        borderStyle="bold"
        borderColor={billing?.error ? 'red' : 'yellow'}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
      >
        <Text bold>Rate Limits</Text>
        <Box height={1} />
        {billing?.error ? (
          <Text color="red">{billing.error}</Text>
        ) : billing?.session || billing?.weekly ? (
          <>
            {billing.session && (
              <LimitBar label="Session" pct={billing.session.utilization} resets={billing.session.resetsAt} />
            )}
            {billing.weekly && (
              <LimitBar label="Weekly" pct={billing.weekly.utilization} resets={billing.weekly.resetsAt} />
            )}
            {billing.sonnet && (
              <LimitBar label="Sonnet" pct={billing.sonnet.utilization} resets={billing.sonnet.resetsAt} />
            )}
            {billing.extraUsage && (
              <Box>
                <Box width={10}><Text dimColor>Extra</Text></Box>
                <Text color="yellow">${billing.extraUsage.used.toFixed(2)}</Text>
                <Text dimColor> / ${billing.extraUsage.limit.toFixed(2)} limit</Text>
              </Box>
            )}
          </>
        ) : (
          <Text dimColor>Fetching...</Text>
        )}
      </Box>
    </>
  )
}

function LimitBar({ label, pct, resets }: { label: string; pct: number; resets: string }) {
  const width = 30
  const filled = Math.round((pct / 100) * width)
  const color = pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green'
  return (
    <Box>
      <Box width={10}><Text dimColor>{label}</Text></Box>
      <Text color={color}>{'━'.repeat(filled)}</Text>
      <Text dimColor>{'─'.repeat(width - filled)}</Text>
      <Text> </Text>
      <Text bold>{Math.round(pct)}%</Text>
      <Text dimColor>  resets {resets}</Text>
    </Box>
  )
}

function SummaryRow({ label, summary }: { label: string; summary: UsageSummary }) {
  return (
    <Box>
      <Box width={14}><Text dimColor>{label}</Text></Box>
      <Box width={12} justifyContent="flex-end"><Text bold color="yellow">{fmt.currency(summary.cost)}</Text></Box>
      <Box width={18} justifyContent="flex-end"><Text dimColor>{fmt.tokens(summary.tokens)} tokens</Text></Box>
    </Box>
  )
}

function TableView({ rows: allRows, cursor, expanded, maxRows, wide, onRowClick }: { rows: TableRow[]; cursor: number; expanded: number; maxRows: number; wide: boolean; onRowClick: (idx: number) => void }) {
  const W = wide
    ? { label: 10, models: 18, input: 8, output: 8, cc: 8, cr: 9, total: 9, cost: 10 }
    : { label: 8, models: 14, input: 7, output: 7, cc: 7, cr: 8, total: 0, cost: 9 }
  const lineW = W.label + W.models + W.input + W.output + W.cc + W.cr + W.total + W.cost

  const totals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0 }
  for (const r of allRows) {
    totals.input += r.input; totals.output += r.output
    totals.cacheCreate += r.cacheCreate; totals.cacheRead += r.cacheRead; totals.cost += r.cost
  }

  const clampedCursor = Math.min(cursor, allRows.length - 1)
  const scrollStart = Math.max(0, Math.min(clampedCursor - Math.floor(maxRows / 2), allRows.length - maxRows))
  const visible = allRows.slice(scrollStart, scrollStart + maxRows)

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>  {fmt.col('Date', W.label, 'left')}</Text>
        <Text bold>{fmt.col('Models', W.models, 'left')}</Text>
        <Text bold>{fmt.col('Input', W.input)}</Text>
        <Text bold>{fmt.col('Output', W.output)}</Text>
        <Text bold>{fmt.col('CchCrt', W.cc)}</Text>
        <Text bold>{fmt.col('CchRd', W.cr)}</Text>
        {W.total > 0 && <Text bold>{fmt.col('Total', W.total)}</Text>}
        <Text bold>{fmt.col('Cost', W.cost)}</Text>
      </Text>
      <Text dimColor>{'─'.repeat(lineW + 2)}</Text>
      {visible.map((r, vi) => {
        const idx = scrollStart + vi
        const selected = idx === clampedCursor
        const isExpanded = idx === expanded
        return (
          <Box key={r.label} flexDirection="column">
            <ClickableBox onClick={() => onRowClick(idx)}>
              <Text inverse={selected}>
                <Text color={selected ? undefined : 'cyan'}>{selected ? '▸ ' : '  '}{fmt.col(fmtLabel(r.label), W.label, 'left')}</Text>
                <Text dimColor={!selected}>{fmt.col(r.models.join(', '), W.models, 'left')}</Text>
                <Text>{fmt.col(fmt.tokens(r.input), W.input)}</Text>
                <Text>{fmt.col(fmt.tokens(r.output), W.output)}</Text>
                <Text>{fmt.col(fmt.tokens(r.cacheCreate), W.cc)}</Text>
                <Text>{fmt.col(fmt.tokens(r.cacheRead), W.cr)}</Text>
                {W.total > 0 && <Text>{fmt.col(fmt.tokens(r.total), W.total)}</Text>}
                <Text bold color={selected ? undefined : 'yellow'}>{fmt.col(fmt.currency(r.cost), W.cost)}</Text>
              </Text>
            </ClickableBox>
            {isExpanded && <RowDetail row={r} indent={W.label + 2} />}
          </Box>
        )
      })}
      <Text dimColor>{'─'.repeat(lineW + 2)}</Text>
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
      <Text dimColor>↑↓ navigate  ·  Enter detail  ·  o sort  ·  g/G top/bottom  ·  {clampedCursor + 1}/{allRows.length}</Text>
      <Box height={1} />
      <Footer />
    </Box>
  )
}

function RowDetail({ row, indent }: { row: TableRow; indent: number }) {
  return (
    <Box flexDirection="column" paddingLeft={indent} marginY={0}>
      {row.breakdown.map((m, i) => {
        const prefix = i === row.breakdown.length - 1 ? '└─' : '├─'
        return (
          <Text key={m.name}>
            <Text dimColor>{prefix} </Text>
            <Text bold>{fmt.col(m.name, 16, 'left')}</Text>
            <Text>{fmt.col(fmt.tokens(m.input), 8)} in  </Text>
            <Text>{fmt.col(fmt.tokens(m.output), 8)} out  </Text>
            <Text>{fmt.col(fmt.tokens(m.cacheCreate), 8)} cc  </Text>
            <Text>{fmt.col(fmt.tokens(m.cacheRead), 9)} cr  </Text>
            <Text bold color="yellow">{fmt.currency(m.cost)}</Text>
          </Text>
        )
      })}
    </Box>
  )
}

function Spinner({ label }: { label: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI(n => (n + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(id)
  }, [])
  return (
    <Box>
      <Text color="green">{SPINNER_FRAMES[i]} </Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}

function fmtLabel(label: string): string {
  if (label.length === 10 && label[4] === '-') return fmt.shortDate(label)
  if (label.length === 7 && label[4] === '-') {
    const m = label.slice(5, 7)
    return `${MONTHS[Number(m)]} '${label.slice(2, 4)}`
  }
  return fmt.shortDate(label)
}

function ClickableBox({ onClick, children, ...props }: { onClick: () => void; children: React.ReactNode } & Record<string, unknown>) {
  const ref = useRef<DOMElement>(null)
  useOnMouseClick(ref, (clicked) => { if (clicked) onClick() })
  return <Box ref={ref} {...props}>{children}</Box>
}
