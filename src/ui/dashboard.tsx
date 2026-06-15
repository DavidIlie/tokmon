import { Box, Text } from 'ink'
import * as fmt from '../format'
import { PROVIDERS } from '../providers'
import type { Account, Metric, ProviderId } from '../providers/types'
import type { UsageSummary, DashboardData } from '../types'
import type { AccountStats } from '../stats'
import { Bar, sparkline, metricValueText, truncateName } from './shared'

type Item = { account: Account; s: AccountStats | undefined }

const GAP = 2
const MIN_CARD = 56

export function DashboardView({ groups, stats, cols, focusId, layout }: {
  groups: { provider: ProviderId; accounts: Account[] }[]
  stats: Map<string, AccountStats>
  cols: number
  focusId: string | null
  layout: 'grid' | 'single'
}) {
  if (groups.length === 0) {
    return <Text dimColor>No providers enabled — press s to pick providers.</Text>
  }

  // 'single' mode shows one provider at a time (cycle with 1-9 / a). When no
  // specific account is focused, default to the first provider.
  let shown = groups
  if (layout === 'single' && focusId === null) shown = groups.slice(0, 1)

  const content = Math.max(MIN_CARD, cols - 4)
  // One full-width hero when focused/single; otherwise a width-calculated grid
  // (1–2 columns) that reflows with the terminal.
  const single = focusId !== null || layout === 'single'
  const auto = Math.max(1, Math.min(2, Math.floor((content + GAP) / (MIN_CARD + GAP))))
  const ncols = single ? 1 : Math.min(auto, shown.length)
  const cardW = ncols <= 1 ? content : Math.floor((content - GAP * (ncols - 1)) / ncols)

  return (
    <Box width={content} flexWrap="wrap" columnGap={GAP} rowGap={1}>
      {shown.map(g => (
        <ProviderCard key={g.provider} provider={g.provider} accounts={g.accounts} stats={stats} width={cardW} />
      ))}
    </Box>
  )
}

function ProviderCard({ provider, accounts, stats, width }: {
  provider: ProviderId
  accounts: Account[]
  stats: Map<string, AccountStats>
  width: number
}) {
  const meta = PROVIDERS[provider]
  const items: Item[] = accounts.map(a => ({ account: a, s: stats.get(a.id) }))
  const dashboards = items.map(i => i.s?.dashboard).filter((d): d is DashboardData => !!d)
  const agg = meta.hasUsage && dashboards.length > 0 ? aggregate(dashboards) : null
  const plan = items.map(i => i.s?.billing?.plan).find(Boolean) ?? null
  const activity = items.map(i => i.s?.billing?.activity).find(Boolean) ?? null
  const inner = width - 4
  const barW = Math.max(10, Math.min(46, inner - 20))
  const hasSpark = !!agg && agg.series.some(v => v > 0)

  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={meta.color} paddingX={1}>
      <Box>
        <Text color={meta.color}>● </Text>
        <Text bold color={meta.color}>{meta.name}</Text>
        <Box flexGrow={1} />
        {plan && <Text dimColor>{plan}</Text>}
      </Box>

      {meta.hasUsage && (
        agg ? (
          <>
            <Box height={1} />
            <SummaryRow label="Today" s={agg.today} />
            <SummaryRow label="This Week" s={agg.week} />
            <SummaryRow label="This Month" s={agg.month} />
            <KpiLine agg={agg} />
          </>
        ) : (
          <><Box height={1} /><Text dimColor>Fetching usage…</Text></>
        )
      )}

      {meta.hasBilling && (
        <>
          {meta.hasUsage && <Rule inner={inner} />}
          <LimitsBlock items={items} barW={barW} />
        </>
      )}

      {hasSpark && (
        <>
          <Rule inner={inner} />
          <SparkFooter series={agg!.series} month={agg!.month.cost} color={meta.color} />
        </>
      )}

      {!meta.hasUsage && activity && (
        <>
          <Rule inner={inner} />
          <Box>
            <Box width={4}><Text dimColor>14d</Text></Box>
            <Text color={meta.color}>{sparkline(activity.series)}</Text>
            <Box flexGrow={1} justifyContent="flex-end"><Text dimColor>{activity.summary}</Text></Box>
          </Box>
        </>
      )}
      {!meta.hasUsage && !activity && (
        <><Box flexGrow={1} /><Text dimColor>Billing only — no local history</Text></>
      )}
    </Box>
  )
}

function Rule({ inner }: { inner: number }) {
  return <Text dimColor>{'─'.repeat(Math.max(0, inner))}</Text>
}

function SummaryRow({ label, s }: { label: string; s: UsageSummary }) {
  const cachedPct = s.tokens > 0 ? Math.round((s.cacheRead / s.tokens) * 100) : 0
  return (
    <Box>
      <Box width={11}><Text dimColor>{label}</Text></Box>
      <Box width={11} justifyContent="flex-end"><Text bold color="yellow">{fmt.currency(s.cost)}</Text></Box>
      <Box width={13} justifyContent="flex-end"><Text dimColor>{fmt.tokens(s.tokens)} tok</Text></Box>
      <Box flexGrow={1} justifyContent="flex-end">
        {cachedPct > 0 ? <Text dimColor>{cachedPct}% cached</Text> : <Text> </Text>}
      </Box>
    </Box>
  )
}

function KpiLine({ agg }: { agg: DashboardData }) {
  const hasBurn = agg.burnRate > 0
  const hasSaved = agg.month.cacheSavings > 0
  if (!hasBurn && !hasSaved) return null
  return (
    <Box>
      {hasBurn && <><Text dimColor>Burn </Text><Text color="red">{fmt.currency(agg.burnRate)}/hr</Text></>}
      <Box flexGrow={1} />
      {hasSaved && <><Text dimColor>Cache saved </Text><Text color="green">{fmt.currency(agg.month.cacheSavings)}/mo</Text></>}
    </Box>
  )
}

function LimitsBlock({ items, barW }: { items: Item[]; barW: number }) {
  const showName = items.length > 1
  return (
    <Box flexDirection="column">
      {items.map(({ account, s }, idx) => {
        const billing = s?.billing
        return (
          <Box key={account.id} flexDirection="column" marginTop={showName && idx > 0 ? 1 : 0}>
            {showName && (
              <Box><Text color={account.color}>● </Text><Text bold>{truncateName(account.name, 22)}</Text></Box>
            )}
            {!billing ? (
              <Text dimColor>Fetching…</Text>
            ) : billing.error ? (
              <Text color="red">{billing.error}</Text>
            ) : billing.metrics.length === 0 ? (
              <Text dimColor>No data</Text>
            ) : (
              billing.metrics.map((m, i) => <MetricRow key={`${m.label}${i}`} m={m} color={account.color} barW={barW} />)
            )}
          </Box>
        )
      })}
    </Box>
  )
}

function MetricRow({ m, color, barW }: { m: Metric; color: string; barW: number }) {
  if (m.format.kind === 'percent') {
    const barColor = m.used >= 90 ? 'red' : m.used >= 75 ? 'yellow' : color
    return (
      <Box>
        <Box width={7}><Text dimColor>{m.label}</Text></Box>
        <Bar pct={m.used} color={barColor} width={barW} />
        <Box width={5} justifyContent="flex-end"><Text bold>{Math.round(m.used)}%</Text></Box>
        <Box width={8} justifyContent="flex-end">
          {m.resetsAt ? <Text dimColor>{m.resetsAt}</Text> : <Text> </Text>}
        </Box>
      </Box>
    )
  }
  return (
    <Box>
      <Box width={7}><Text dimColor>{m.label}</Text></Box>
      <Text bold color="yellow">{metricValueText(m)}</Text>
    </Box>
  )
}

function SparkFooter({ series, month, color }: { series: number[]; month: number; color: string }) {
  return (
    <Box>
      <Box width={4}><Text dimColor>14d</Text></Box>
      <Text color={color}>{sparkline(series)}</Text>
      <Box flexGrow={1} justifyContent="flex-end"><Text dimColor>{fmt.currency(month)} mo</Text></Box>
    </Box>
  )
}

function aggregate(list: DashboardData[]): DashboardData {
  const zero = () => ({ cost: 0, tokens: 0, cacheRead: 0, cacheSavings: 0 })
  const z: DashboardData = { today: zero(), week: zero(), month: zero(), burnRate: 0, series: [] }
  for (const d of list) {
    for (const k of ['today', 'week', 'month'] as const) {
      z[k].cost += d[k].cost; z[k].tokens += d[k].tokens
      z[k].cacheRead += d[k].cacheRead; z[k].cacheSavings += d[k].cacheSavings
    }
    z.burnRate += d.burnRate
    d.series.forEach((v, i) => { z.series[i] = (z.series[i] ?? 0) + v })
  }
  return z
}
