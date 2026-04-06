import { useState, useEffect } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { fetchData } from './data'
import * as fmt from './format'
import type { AppData, UsageSummary, BlockInfo, DailyRow } from './types'

const TABS = ['Dashboard', 'Daily'] as const
type Tab = typeof TABS[number]

export function App({ interval = 2000 }: { interval?: number }) {
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(new Date())
  const [tab, setTab] = useState<number>(0)
  const [scroll, setScroll] = useState(0)
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24

  const isTTY = process.stdin.isTTY === true

  useInput((input, key) => {
    if (key.tab || key.rightArrow) { setTab(t => (t + 1) % TABS.length); setScroll(0) }
    if (key.leftArrow) { setTab(t => (t - 1 + TABS.length) % TABS.length); setScroll(0) }
    if (key.upArrow) setScroll(s => Math.max(0, s - 1))
    if (key.downArrow) setScroll(s => s + 1)
    if (input === '1') { setTab(0); setScroll(0) }
    if (input === '2') { setTab(1); setScroll(0) }
  }, { isActive: isTTY })

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await fetchData()
        if (active) { setData(result); setError(null); setUpdated(new Date()) }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const id = setInterval(load, interval)
    return () => { active = false; clearInterval(id) }
  }, [interval])

  if (error) return <Box padding={1}><Text color="red">{error}</Text></Box>
  if (!data) return <Box padding={1}><Text dimColor>Loading...</Text></Box>

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="greenBright">{'◉'} tokmon</Text>
          <Text dimColor>  ·  {interval / 1000}s</Text>
        </Box>
        <Text dimColor>{fmt.time(updated)}</Text>
      </Box>
      <Box marginTop={1}>
        <TabBar tabs={TABS} active={tab} />
        <Text dimColor>  ←→ or 1-{TABS.length}</Text>
      </Box>
      <Box height={1} />
      {TABS[tab] === 'Dashboard' && <DashboardView data={data} />}
      {TABS[tab] === 'Daily' && <DailyView daily={data.daily} scroll={scroll} maxRows={rows - 10} />}
      <Box marginTop={1}>
        <Text dimColor>by </Text>
        <Text>David Ilie</Text>
        <Text dimColor> (</Text>
        <Text color="cyan">davidilie.com</Text>
        <Text dimColor>)</Text>
      </Box>
    </Box>
  )
}

function TabBar({ tabs, active }: { tabs: readonly string[]; active: number }) {
  return (
    <Box>
      {tabs.map((t, i) => (
        <Box key={t} marginRight={1}>
          {i === active
            ? <Text bold inverse> {t} </Text>
            : <Text dimColor> {t} </Text>
          }
        </Box>
      ))}
    </Box>
  )
}

function DashboardView({ data }: { data: AppData }) {
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

      {data.block && (
        <>
          <Box height={1} />
          <BlockView block={data.block} />
        </>
      )}

      <Box height={1} />
      <Text dimColor>{'─'.repeat(50)}</Text>
      <Box justifyContent="space-between" width={50}>
        <Box>
          <Text dimColor>Total </Text>
          <Text bold color="yellowBright">{fmt.currency(data.month.cost)}</Text>
        </Box>
      </Box>
    </>
  )
}

function BlockView({ block }: { block: BlockInfo }) {
  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      borderStyle="bold"
      borderColor="yellow"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
    >
      <Box>
        <Text bold>Active Block</Text>
        <Text dimColor>  {block.remaining} remaining</Text>
      </Box>
      <Box height={1} />
      <Box>
        <ProgressBar percent={block.percent} width={36} />
        <Text> </Text>
        <Text bold>{Math.round(block.percent)}%</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="yellow">{fmt.currency(block.spent)}</Text>
        <Text dimColor> spent  ·  ~</Text>
        <Text>{fmt.currency(block.projected)}</Text>
        <Text dimColor> proj  ·  </Text>
        <Text color="red">{fmt.currency(block.burnRate)}</Text>
        <Text dimColor>/hr</Text>
      </Box>
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

function ProgressBar({ percent, width = 36 }: { percent: number; width?: number }) {
  const filled = Math.round((percent / 100) * width)
  return (
    <Text>
      <Text color="greenBright">{'━'.repeat(filled)}</Text>
      <Text dimColor>{'─'.repeat(width - filled)}</Text>
    </Text>
  )
}

function DailyView({ daily, scroll, maxRows }: { daily: DailyRow[]; scroll: number; maxRows: number }) {
  const COL = { date: 12, models: 20, input: 10, output: 10, cc: 12, cr: 14, total: 14, cost: 10 }

  const totals: DailyRow = {
    date: 'Total',
    models: [],
    input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0, cost: 0,
  }
  for (const r of daily) {
    totals.input += r.input
    totals.output += r.output
    totals.cacheCreate += r.cacheCreate
    totals.cacheRead += r.cacheRead
    totals.total += r.total
    totals.cost += r.cost
  }

  const visible = daily.slice(scroll, scroll + maxRows)
  const canScrollDown = scroll + maxRows < daily.length

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{fmt.pad('Date', COL.date, 'left')}</Text>
        <Text bold>{fmt.pad('Models', COL.models, 'left')}</Text>
        <Text bold>{fmt.pad('Input', COL.input)}</Text>
        <Text bold>{fmt.pad('Output', COL.output)}</Text>
        <Text bold>{fmt.pad('Cache Crt', COL.cc)}</Text>
        <Text bold>{fmt.pad('Cache Read', COL.cr)}</Text>
        <Text bold>{fmt.pad('Total', COL.total)}</Text>
        <Text bold>{fmt.pad('Cost', COL.cost)}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(COL.date + COL.models + COL.input + COL.output + COL.cc + COL.cr + COL.total + COL.cost)}</Text>

      {visible.map(r => (
        <Box key={r.date}>
          <Text color="cyan">{fmt.pad(r.date, COL.date, 'left')}</Text>
          <Text dimColor>{fmt.pad(r.models.join(', '), COL.models, 'left')}</Text>
          <Text>{fmt.pad(fmt.num(r.input), COL.input)}</Text>
          <Text>{fmt.pad(fmt.num(r.output), COL.output)}</Text>
          <Text>{fmt.pad(fmt.num(r.cacheCreate), COL.cc)}</Text>
          <Text>{fmt.pad(fmt.num(r.cacheRead), COL.cr)}</Text>
          <Text>{fmt.pad(fmt.num(r.total), COL.total)}</Text>
          <Text bold color="yellow">{fmt.pad(fmt.currency(r.cost), COL.cost)}</Text>
        </Box>
      ))}

      {canScrollDown && <Text dimColor>  ↓ {daily.length - scroll - maxRows} more rows</Text>}

      <Text dimColor>{'─'.repeat(COL.date + COL.models + COL.input + COL.output + COL.cc + COL.cr + COL.total + COL.cost)}</Text>
      <Box>
        <Text bold color="greenBright">{fmt.pad('Total', COL.date, 'left')}</Text>
        <Text>{fmt.pad('', COL.models, 'left')}</Text>
        <Text bold color="yellow">{fmt.pad(fmt.tokens(totals.input), COL.input)}</Text>
        <Text bold color="yellow">{fmt.pad(fmt.tokens(totals.output), COL.output)}</Text>
        <Text bold color="yellow">{fmt.pad(fmt.tokens(totals.cacheCreate), COL.cc)}</Text>
        <Text bold color="yellow">{fmt.pad(fmt.tokens(totals.cacheRead), COL.cr)}</Text>
        <Text bold color="yellow">{fmt.pad(fmt.tokens(totals.total), COL.total)}</Text>
        <Text bold color="yellowBright">{fmt.pad(fmt.currency(totals.cost), COL.cost)}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ scroll  ·  {daily.length} days  ·  showing {scroll + 1}-{Math.min(scroll + maxRows, daily.length)}</Text>
      </Box>
    </Box>
  )
}
