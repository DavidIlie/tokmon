import { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { fetchUsage } from './data'
import * as fmt from './format'
import type { UsageData, UsageSummary, BlockInfo } from './types'

const INTERVAL = 2000

export function App() {
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(new Date())

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = await fetchUsage()
        if (active) {
          setData(result)
          setError(null)
          setUpdated(new Date())
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const id = setInterval(load, INTERVAL)
    return () => { active = false; clearInterval(id) }
  }, [])

  if (error) return <Box padding={1}><Text color="red">{error}</Text></Box>
  if (!data) return <Box padding={1}><Text dimColor>Loading...</Text></Box>

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Header />
      <Box height={1} />
      <UsageSection color="green" title="Claude" data={data} />
      {data.block && (
        <>
          <Box height={1} />
          <BlockSection block={data.block} />
        </>
      )}
      <Box height={1} />
      <Divider />
      <Footer cost={data.month.cost} updated={updated} />
    </Box>
  )
}

function Header() {
  return (
    <Box>
      <Text bold color="greenBright">{'◉'} tokmon</Text>
      <Text dimColor>  ·  refreshing every {INTERVAL / 1000}s</Text>
    </Box>
  )
}

function UsageSection({ color, title, data }: { color: string; title: string; data: UsageData }) {
  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      borderStyle="bold"
      borderColor={color}
      borderRight={false}
      borderTop={false}
      borderBottom={false}
    >
      <Text bold>{title}</Text>
      <Box height={1} />
      <Row label="Today" summary={data.today} />
      <Row label="This Week" summary={data.week} />
      <Row label="This Month" summary={data.month} />
    </Box>
  )
}

function BlockSection({ block }: { block: BlockInfo }) {
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
        <Bar percent={block.percent} width={36} />
        <Text> </Text>
        <Text bold>{Math.round(block.percent)}%</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="yellow">{fmt.currency(block.spent)}</Text>
        <Text dimColor> spent</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>~</Text><Text>{fmt.currency(block.projected)}</Text>
        <Text dimColor> proj</Text>
        <Text dimColor>  ·  </Text>
        <Text color="red">{fmt.currency(block.burnRate)}</Text>
        <Text dimColor>/hr</Text>
      </Box>
    </Box>
  )
}

function Row({ label, summary }: { label: string; summary: UsageSummary }) {
  return (
    <Box>
      <Box width={14}><Text dimColor>{label}</Text></Box>
      <Box width={12} justifyContent="flex-end"><Text bold color="yellow">{fmt.currency(summary.cost)}</Text></Box>
      <Box width={18} justifyContent="flex-end"><Text dimColor>{fmt.tokens(summary.tokens)} tokens</Text></Box>
    </Box>
  )
}

function Bar({ percent, width = 36 }: { percent: number; width?: number }) {
  const filled = Math.round((percent / 100) * width)
  return (
    <Text>
      <Text color="greenBright">{'━'.repeat(filled)}</Text>
      <Text dimColor>{'─'.repeat(width - filled)}</Text>
    </Text>
  )
}

function Divider() {
  return <Text dimColor>{'─'.repeat(50)}</Text>
}

function Footer({ cost, updated }: { cost: number; updated: Date }) {
  return (
    <>
      <Box justifyContent="space-between" width={50}>
        <Box>
          <Text dimColor>Total </Text>
          <Text bold color="yellowBright">{fmt.currency(cost)}</Text>
        </Box>
        <Text dimColor>{fmt.time(updated)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>by </Text>
        <Text>David Ilie</Text>
        <Text dimColor> (</Text>
        <Text color="cyan">davidilie.com</Text>
        <Text dimColor>)</Text>
      </Box>
    </>
  )
}
