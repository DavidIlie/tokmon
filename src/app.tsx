import { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { fetchData } from './data'
import { loadConfig, saveConfig, configLocation, type Config } from './config'
import * as fmt from './format'
import type { AppData, UsageSummary, BlockInfo, DailyRow } from './types'

const TABS = ['Dashboard', 'Daily'] as const

export function App({ interval: initialInterval }: { interval?: number }) {
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(new Date())
  const [tab, setTab] = useState(0)
  const [scroll, setScroll] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<Config>({ interval: (initialInterval ?? 2000) / 1000 })
  const [settingsCursor, setSettingsCursor] = useState(0)
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24
  const interval = config.interval * 1000

  useEffect(() => {
    loadConfig().then(c => {
      if (!initialInterval) setConfig(c)
      else setConfig({ ...c, interval: initialInterval / 1000 })
    })
  }, [])

  const isTTY = process.stdin.isTTY === true

  useInput((input, key) => {
    if (showSettings) {
      if (key.escape || input === 's') setShowSettings(false)
      if (key.upArrow) setSettingsCursor(c => Math.max(0, c - 1))
      if (key.downArrow) setSettingsCursor(c => Math.min(0, c + 1))
      if (key.leftArrow && settingsCursor === 0) {
        setConfig(c => {
          const next = { ...c, interval: Math.max(1, c.interval - 1) }
          saveConfig(next)
          return next
        })
      }
      if (key.rightArrow && settingsCursor === 0) {
        setConfig(c => {
          const next = { ...c, interval: c.interval + 1 }
          saveConfig(next)
          return next
        })
      }
      return
    }

    if (input === 's') { setShowSettings(true); return }
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
          <Text dimColor>  ·  {config.interval}s</Text>
        </Box>
        <Text dimColor>{fmt.time(updated)}</Text>
      </Box>

      {showSettings ? (
        <SettingsView config={config} cursor={settingsCursor} />
      ) : (
        <>
          <Box marginTop={1}>
            <TabBar tabs={TABS} active={tab} />
            <Text dimColor>  Tab/←→  s=settings</Text>
          </Box>
          <Box height={1} />
          {TABS[tab] === 'Dashboard' && <DashboardView data={data} />}
          {TABS[tab] === 'Daily' && <DailyView daily={data.daily} scroll={scroll} maxRows={rows - 10} />}
        </>
      )}

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

function SettingsView({ config, cursor }: { config: Config; cursor: number }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Settings</Text>
      <Text dimColor>Saved to {configLocation()}</Text>
      <Box height={1} />
      <Box>
        {cursor === 0 ? <Text color="green">{'▸'} </Text> : <Text>  </Text>}
        <Text>Refresh interval  </Text>
        <Text dimColor>{'◂'} </Text>
        <Text bold color="yellow">{config.interval}s</Text>
        <Text dimColor> {'▸'}</Text>
        <Text dimColor>  (←→ to adjust)</Text>
      </Box>
      <Box height={1} />
      <Text dimColor>Press s or Esc to close</Text>
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
  const W = { date: 7, models: 16, input: 8, output: 8, cc: 8, cr: 8, cost: 10 }
  const lineW = W.date + W.models + W.input + W.output + W.cc + W.cr + W.cost

  const totals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0 }
  for (const r of daily) {
    totals.input += r.input
    totals.output += r.output
    totals.cacheCreate += r.cacheCreate
    totals.cacheRead += r.cacheRead
    totals.cost += r.cost
  }

  const visible = daily.slice(scroll, scroll + maxRows)
  const more = daily.length - scroll - maxRows

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{fmt.col('Date', W.date, 'left')}</Text>
        <Text bold>{fmt.col('Models', W.models, 'left')}</Text>
        <Text bold>{fmt.col('Input', W.input)}</Text>
        <Text bold>{fmt.col('Output', W.output)}</Text>
        <Text bold>{fmt.col('CchCrt', W.cc)}</Text>
        <Text bold>{fmt.col('CchRd', W.cr)}</Text>
        <Text bold>{fmt.col('Cost', W.cost)}</Text>
      </Text>
      <Text dimColor>{'─'.repeat(lineW)}</Text>

      {visible.map(r => (
        <Text key={r.date}>
          <Text color="cyan">{fmt.col(fmt.shortDate(r.date), W.date, 'left')}</Text>
          <Text dimColor>{fmt.col(r.models.join(', '), W.models, 'left')}</Text>
          <Text>{fmt.col(fmt.tokens(r.input), W.input)}</Text>
          <Text>{fmt.col(fmt.tokens(r.output), W.output)}</Text>
          <Text>{fmt.col(fmt.tokens(r.cacheCreate), W.cc)}</Text>
          <Text>{fmt.col(fmt.tokens(r.cacheRead), W.cr)}</Text>
          <Text bold color="yellow">{fmt.col(fmt.currency(r.cost), W.cost)}</Text>
        </Text>
      ))}

      {more > 0 && <Text dimColor>  ↓ {more} more</Text>}

      <Text dimColor>{'─'.repeat(lineW)}</Text>
      <Text>
        <Text bold color="greenBright">{fmt.col('Total', W.date, 'left')}</Text>
        <Text>{fmt.col('', W.models, 'left')}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.input), W.input)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.output), W.output)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.cacheCreate), W.cc)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.cacheRead), W.cr)}</Text>
        <Text bold color="yellowBright">{fmt.col(fmt.currency(totals.cost), W.cost)}</Text>
      </Text>

      <Box marginTop={1}>
        <Text dimColor>↑↓ scroll  ·  {daily.length} days  ·  {scroll + 1}-{Math.min(scroll + maxRows, daily.length)}</Text>
      </Box>
    </Box>
  )
}
