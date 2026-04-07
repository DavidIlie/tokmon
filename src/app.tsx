import { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput, useStdout, useApp } from 'ink'
import { fetchDashboard, fetchTable, type DashboardData, type TableData } from './data'
import { fetchBilling, type BillingData } from './billing'
import { loadConfig, saveConfig, configLocation, type Config } from './config'
import * as fmt from './format'
import type { UsageSummary, TableRow } from './types'

const TABS = ['Dashboard', 'Table'] as const
const VIEWS = ['Daily', 'Weekly', 'Monthly'] as const

export function App({ interval: cliInterval }: { interval?: number }) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [billing, setBilling] = useState<BillingData | null>(null)
  const [table, setTable] = useState<TableData | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(new Date())
  const [tab, setTab] = useState(0)
  const [view, setView] = useState(0)
  const [scroll, setScroll] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [settingsCursor, setSettingsCursor] = useState(0)
  const tableLoadedOnce = useRef(false)
  const { stdout } = useStdout()
  const { exit } = useApp()
  const rows = stdout?.rows ?? 24
  const cols = stdout?.columns ?? 80
  const interval = cliInterval ?? (config?.interval ?? 2) * 1000
  const cfg = config ?? { interval: 2, clearScreen: true }

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

  useEffect(() => {
    let active = true
    const load = () => fetchBilling().then(b => { if (active && b) setBilling(b) }).catch(() => {})
    load()
    const id = setInterval(load, 120_000)
    return () => { active = false; clearInterval(id) }
  }, [])

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

  const isTTY = process.stdin.isTTY === true

  useInput((input, key) => {
    if (showSettings) {
      if (key.escape || input === 's') setShowSettings(false)
      if (key.upArrow) setSettingsCursor(c => Math.max(0, c - 1))
      if (key.downArrow) setSettingsCursor(c => Math.min(1, c + 1))
      if (settingsCursor === 0) {
        if (key.leftArrow) setConfig(c => { const n = { ...c!, interval: Math.max(1, c!.interval - 1) }; saveConfig(n); return n })
        if (key.rightArrow) setConfig(c => { const n = { ...c!, interval: c!.interval + 1 }; saveConfig(n); return n })
      }
      if (settingsCursor === 1 && (key.leftArrow || key.rightArrow || key.return)) {
        setConfig(c => { const n = { ...c!, clearScreen: !c!.clearScreen }; saveConfig(n); return n })
      }
      return
    }

    if (input === 'q') { exit(); return }
    if (input === 's') { setShowSettings(true); return }
    if (key.tab) { setTab(t => (t + 1) % TABS.length); setScroll(0); return }
    if (input === '1') { setTab(0); setScroll(0); return }
    if (input === '2') { setTab(1); setScroll(0); return }

    if (tab === 1) {
      if (input === 'd') { setView(0); setScroll(0); return }
      if (input === 'w') { setView(1); setScroll(0); return }
      if (input === 'm') { setView(2); setScroll(0); return }
      if (key.leftArrow) { setView(v => (v - 1 + VIEWS.length) % VIEWS.length); setScroll(0); return }
      if (key.rightArrow) { setView(v => (v + 1) % VIEWS.length); setScroll(0); return }
    } else {
      if (key.leftArrow || key.rightArrow) { setTab(t => (t + 1) % TABS.length); setScroll(0); return }
    }

    if (key.upArrow) setScroll(s => Math.max(0, s - 1))
    if (key.downArrow) setScroll(s => s + 1)
    if (key.pageDown) setScroll(s => s + Math.max(1, rows - 12))
    if (key.pageUp) setScroll(s => Math.max(0, s - Math.max(1, rows - 12)))
  }, { isActive: isTTY })

  if (error) return <Box padding={1}><Text color="red">{error}</Text></Box>
  if (!dashboard) return <Box padding={1}><Text dimColor>Loading...</Text></Box>

  const tableData = table ? [table.daily, table.weekly, table.monthly][view] : []

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} minHeight={rows}>
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="greenBright">{'◉'} tokmon</Text>
          <Text dimColor>  ·  {cliInterval ? cliInterval / 1000 : cfg.interval}s</Text>
        </Box>
        <Text dimColor>{fmt.time(updated)}</Text>
      </Box>

      {showSettings ? (
        <SettingsView config={cfg} cursor={settingsCursor} />
      ) : (
        <>
          <Box marginTop={1}>
            <TabBar tabs={TABS} active={tab} />
            <Text dimColor>  Tab/←→</Text>
          </Box>
          <Box height={1} />
          {tab === 0 && <DashboardView data={dashboard} billing={billing} />}
          {tab === 1 && (
            <>
              <ViewBar views={VIEWS} active={view} />
              <Box height={1} />
              {tableLoading && !table
                ? <Text dimColor>Loading 6 months of history...</Text>
                : <TableView rows={tableData} scroll={scroll} maxRows={rows - 12} wide={cols > 90} />
              }
            </>
          )}
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>by </Text>
        <Text>David Ilie</Text>
        <Text dimColor> (</Text>
        <Text color="cyan">davidilie.com</Text>
        <Text dimColor>)  ·  s=settings  q=quit</Text>
      </Box>
    </Box>
  )
}

function TabBar({ tabs, active }: { tabs: readonly string[]; active: number }) {
  return (
    <Box>
      {tabs.map((t, i) => (
        <Box key={t} marginRight={1}>
          {i === active ? <Text bold inverse> {t} </Text> : <Text dimColor> {t} </Text>}
        </Box>
      ))}
    </Box>
  )
}

function ViewBar({ views, active }: { views: readonly string[]; active: number }) {
  return (
    <Box>
      {views.map((v, i) => (
        <Box key={v} marginRight={2}>
          {i === active ? <Text bold color="cyan">[{v}]</Text> : <Text dimColor>{v}</Text>}
        </Box>
      ))}
      <Text dimColor>  d/w/m or ←→</Text>
    </Box>
  )
}

function SettingsView({ config, cursor }: { config: Config; cursor: number }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Settings</Text>
      <Text dimColor>{configLocation()}</Text>
      <Box height={1} />
      <Box>
        <Text color={cursor === 0 ? 'green' : undefined}>{cursor === 0 ? '▸' : ' '} </Text>
        <Text>Refresh interval  </Text>
        <Text dimColor>{'◂'} </Text>
        <Text bold color="yellow">{config.interval}s</Text>
        <Text dimColor> {'▸'}</Text>
      </Box>
      <Box>
        <Text color={cursor === 1 ? 'green' : undefined}>{cursor === 1 ? '▸' : ' '} </Text>
        <Text>Clear screen      </Text>
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
      </Box>

      {billing && (
        <>
          <Box height={1} />
          <Box
            flexDirection="column"
            paddingLeft={1}
            borderStyle="bold"
            borderColor="yellow"
            borderRight={false}
            borderTop={false}
            borderBottom={false}
          >
            <Text bold>Rate Limits</Text>
            <Box height={1} />
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
          </Box>
        </>
      )}

      <Box height={1} />
      <Text dimColor>{'─'.repeat(50)}</Text>
      <Box width={50}>
        <Text dimColor>Total </Text>
        <Text bold color="yellowBright">{fmt.currency(data.month.cost)}</Text>
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

function TableView({ rows: allRows, scroll, maxRows, wide }: { rows: TableRow[]; scroll: number; maxRows: number; wide: boolean }) {
  const W = wide
    ? { label: 10, models: 18, input: 8, output: 8, cc: 8, cr: 9, total: 9, cost: 10 }
    : { label: 8, models: 14, input: 7, output: 7, cc: 7, cr: 8, total: 0, cost: 9 }
  const lineW = W.label + W.models + W.input + W.output + W.cc + W.cr + W.total + W.cost

  const totals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0 }
  for (const r of allRows) {
    totals.input += r.input; totals.output += r.output
    totals.cacheCreate += r.cacheCreate; totals.cacheRead += r.cacheRead; totals.cost += r.cost
  }

  const clampedScroll = Math.min(scroll, Math.max(0, allRows.length - maxRows))
  const visible = allRows.slice(clampedScroll, clampedScroll + maxRows)
  const more = allRows.length - clampedScroll - maxRows

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{fmt.col('Date', W.label, 'left')}</Text>
        <Text bold>{fmt.col('Models', W.models, 'left')}</Text>
        <Text bold>{fmt.col('Input', W.input)}</Text>
        <Text bold>{fmt.col('Output', W.output)}</Text>
        <Text bold>{fmt.col('CchCrt', W.cc)}</Text>
        <Text bold>{fmt.col('CchRd', W.cr)}</Text>
        {W.total > 0 && <Text bold>{fmt.col('Total', W.total)}</Text>}
        <Text bold>{fmt.col('Cost', W.cost)}</Text>
      </Text>
      <Text dimColor>{'─'.repeat(lineW)}</Text>
      {visible.map(r => (
        <Text key={r.label}>
          <Text color="cyan">{fmt.col(fmtLabel(r.label), W.label, 'left')}</Text>
          <Text dimColor>{fmt.col(r.models.join(', '), W.models, 'left')}</Text>
          <Text>{fmt.col(fmt.tokens(r.input), W.input)}</Text>
          <Text>{fmt.col(fmt.tokens(r.output), W.output)}</Text>
          <Text>{fmt.col(fmt.tokens(r.cacheCreate), W.cc)}</Text>
          <Text>{fmt.col(fmt.tokens(r.cacheRead), W.cr)}</Text>
          {W.total > 0 && <Text>{fmt.col(fmt.tokens(r.total), W.total)}</Text>}
          <Text bold color="yellow">{fmt.col(fmt.currency(r.cost), W.cost)}</Text>
        </Text>
      ))}
      {more > 0 && <Text dimColor>  ↓ {more} more</Text>}
      <Text dimColor>{'─'.repeat(lineW)}</Text>
      <Text>
        <Text bold color="greenBright">{fmt.col('Total', W.label, 'left')}</Text>
        <Text>{fmt.col('', W.models, 'left')}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.input), W.input)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.output), W.output)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.cacheCreate), W.cc)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.cacheRead), W.cr)}</Text>
        {W.total > 0 && <Text bold color="yellow">{fmt.col(fmt.tokens(totals.input + totals.output + totals.cacheCreate + totals.cacheRead), W.total)}</Text>}
        <Text bold color="yellowBright">{fmt.col(fmt.currency(totals.cost), W.cost)}</Text>
      </Text>
      <Box marginTop={1}>
        <Text dimColor>↑↓ PgUp/Dn scroll  ·  {allRows.length} rows  ·  {clampedScroll + 1}-{Math.min(clampedScroll + maxRows, allRows.length)}</Text>
      </Box>
    </Box>
  )
}

function fmtLabel(label: string): string {
  if (label.length === 10 && label[4] === '-') return fmt.shortDate(label)
  if (label.length === 7 && label[4] === '-') {
    const [, m] = label.split('-')
    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[Number(m)]} '${label.slice(2, 4)}`
  }
  return fmt.shortDate(label)
}
