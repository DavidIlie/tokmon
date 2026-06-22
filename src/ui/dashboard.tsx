import { memo } from 'react'
import { Box, Text } from 'ink'
import * as fmt from '../format'
import { PROVIDERS } from '../providers'
import type { Account, Metric, ProviderId } from '../providers/types'
import type { UsageSummary, DashboardData } from '../types'
import type { AccountStats } from '../stats'
import { Bar, sparkline, metricValueText, truncateName } from './shared'
import { glyphs } from '../glyphs'

type Item = { account: Account; s: AccountStats | undefined }

const GAP = 2
const MIN_CARD = 56
const MIN_CARD_DENSE = 50
const CARD_H = { full: 14, compact: 12, mini: 8 } as const
export type Variant = keyof typeof CARD_H
const VARIANT_ORDER: Variant[] = ['full', 'compact', 'mini']
const INDICATOR_ROWS = 1
const MAX_SINGLE_CARD = Math.round(MIN_CARD * 1.6)

export type GridLayout = {
  ncols: number
  variant: Variant
  cardsPerPage: number
  pageCount: number
}

export function chooseLayout(content: number, budget: number, n: number, single: boolean, cols: number): GridLayout {
  if (n <= 0) return { ncols: 1, variant: 'mini', cardsPerPage: 1, pageCount: 1 }

  const gridHeight = (rows: number, H: number) => rows * H + Math.max(0, rows - 1)

  const colCap = single ? 1
    : cols >= 3 * MIN_CARD_DENSE + 2 * GAP ? 3
    : cols >= 2 * MIN_CARD + GAP ? 2
    : 1
  const maxCols = Math.max(1, Math.min(colCap, n))
  const cardWidthAt = (nc: number) => nc <= 1 ? content : Math.floor((content - GAP * (nc - 1)) / nc)
  const minWidthAt = (nc: number) => nc >= 3 ? MIN_CARD_DENSE : MIN_CARD

  for (const variant of VARIANT_ORDER) {
    for (let nc = maxCols; nc >= 1; nc--) {
      if (nc > 1 && cardWidthAt(nc) < minWidthAt(nc)) continue
      const rows = Math.ceil(n / nc)
      if (gridHeight(rows, CARD_H[variant]) <= budget) {
        return { ncols: nc, variant, cardsPerPage: n, pageCount: 1 }
      }
    }
  }

  let ncols = 1
  for (let nc = maxCols; nc >= 1; nc--) {
    if (nc === 1 || cardWidthAt(nc) >= minWidthAt(nc)) { ncols = nc; break }
  }
  const H = CARD_H.mini
  const fitBudget = budget - INDICATOR_ROWS
  const rowsThatFit = Math.max(1, Math.floor((fitBudget + 1) / (H + 1)))
  const cardsPerPage = Math.max(1, rowsThatFit * ncols)
  const pageCount = Math.max(1, Math.ceil(n / cardsPerPage))
  return { ncols, variant: 'mini', cardsPerPage, pageCount }
}

export const DashboardView = memo(function DashboardView({ groups, stats, cols, budget, focusId, layout, page = 0 }: {
  groups: { provider: ProviderId; accounts: Account[] }[]
  stats: Map<string, AccountStats>
  cols: number
  budget: number
  focusId: string | null
  layout: 'grid' | 'single'
  page?: number
}) {
  if (groups.length === 0) {
    return <Text dimColor>No providers enabled {glyphs().emDash} press s to pick providers.</Text>
  }

  let shown = groups
  if (layout === 'single' && focusId === null) shown = groups.slice(0, 1)

  const single = focusId !== null || layout === 'single'
  const content = Math.max(MIN_CARD, cols - 4)
  const { ncols, variant, cardsPerPage, pageCount } = chooseLayout(content, budget, shown.length, single, cols)

  let cardW = ncols <= 1 ? content : Math.floor((content - GAP * (ncols - 1)) / ncols)
  if (ncols === 1 && cardW > MAX_SINGLE_CARD) cardW = MAX_SINGLE_CARD

  const pg = pageCount > 1 ? ((page % pageCount) + pageCount) % pageCount : 0
  const visible = pageCount > 1
    ? shown.slice(pg * cardsPerPage, pg * cardsPerPage + cardsPerPage)
    : shown

  return (
    <Box height={budget} flexDirection="column" overflow="hidden">
      <Box width={content} flexWrap="wrap" columnGap={GAP} rowGap={1}>
        {visible.map(g => (
          <Box key={g.provider} flexShrink={0}>
            <ProviderCard provider={g.provider} accounts={g.accounts} stats={stats} width={cardW} variant={variant} />
          </Box>
        ))}
      </Box>
      {pageCount > 1 && (
        <Text dimColor>  {glyphs().middot} page {pg + 1}/{pageCount} {glyphs().middot} scroll {glyphs().arrowU}{glyphs().arrowD}</Text>
      )}
    </Box>
  )
})

function ProviderCard({ provider, accounts, stats, width, variant }: {
  provider: ProviderId
  accounts: Account[]
  stats: Map<string, AccountStats>
  width: number
  variant: Variant
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
  const showBars = variant !== 'mini'
  const showSpark = variant === 'full'

  return (
    <Box flexDirection="column" width={width} borderStyle={glyphs().border} borderColor={meta.color} paddingX={1}>
      <Box>
        <Text color={meta.color}>{glyphs().dot} </Text>
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
          <><Box height={1} /><Text dimColor>Fetching usage{glyphs().ellipsis}</Text></>
        )
      )}

      {meta.hasBilling && showBars && (
        <>
          {meta.hasUsage && <Rule inner={inner} />}
          <LimitsBlock items={items} barW={barW} />
        </>
      )}
      {meta.hasBilling && !showBars && !meta.hasUsage && (
        <CompactBilling items={items} />
      )}

      {hasSpark && showSpark && (
        <>
          <Rule inner={inner} />
          <SparkFooter series={agg!.series} month={agg!.month.cost} color={meta.color} />
        </>
      )}

      {!meta.hasUsage && activity && showSpark && (
        <>
          <Rule inner={inner} />
          <Box>
            <Box width={4}><Text dimColor>14d</Text></Box>
            <Text color={meta.color}>{sparkline(activity.series)}</Text>
            <Box flexGrow={1} justifyContent="flex-end"><Text dimColor>{activity.summary}</Text></Box>
          </Box>
        </>
      )}
    </Box>
  )
}

function CompactBilling({ items }: { items: Item[] }) {
  const billing = items.map(i => i.s?.billing).find(Boolean)
  if (!billing) return <Text dimColor>Fetching{glyphs().ellipsis}</Text>
  if (billing.error) return <Text color="red">{billing.error}</Text>
  const m = billing.metrics[0]
  if (!m) return <Text dimColor>No data</Text>
  return <Text bold color="yellow">{metricValueText(m)}</Text>
}

function Rule({ inner }: { inner: number }) {
  return <Text dimColor>{glyphs().rule.repeat(Math.max(0, inner))}</Text>
}

function SummaryRow({ label, s }: { label: string; s: UsageSummary }) {
  const cachedPct = s.tokens > 0 ? Math.round((s.cacheRead / s.tokens) * 100) : 0
  return (
    <Box>
      <Box width={11} flexShrink={0}><Text dimColor wrap="truncate">{label}</Text></Box>
      <Box width={11} flexShrink={0} justifyContent="flex-end"><Text bold color="yellow" wrap="truncate">{fmt.currency(s.cost)}</Text></Box>
      <Box width={13} flexShrink={0} justifyContent="flex-end"><Text dimColor wrap="truncate">{fmt.tokens(s.tokens)} tok</Text></Box>
      <Box flexGrow={1} justifyContent="flex-end">
        {cachedPct > 0 ? <Text dimColor wrap="truncate">{cachedPct}% cached</Text> : <Text> </Text>}
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
              <Box><Text color={account.color}>{glyphs().dot} </Text><Text bold>{truncateName(account.name, 22)}</Text></Box>
            )}
            {!billing ? (
              <Text dimColor>Fetching{glyphs().ellipsis}</Text>
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
        <Box width={7}><Text dimColor wrap="truncate">{m.label}</Text></Box>
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
      <Box width={7}><Text dimColor wrap="truncate">{m.label}</Text></Box>
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

export const TotalsRow = memo(function TotalsRow({ groups, stats, cols }: {
  groups: { provider: ProviderId; accounts: Account[] }[]
  stats: Map<string, AccountStats>
  cols: number
}) {
  const zero = (): UsageSummary => ({ cost: 0, tokens: 0, cacheRead: 0, cacheSavings: 0 })
  const t = zero(), w = zero(), m = zero()
  for (const g of groups) {
    if (!PROVIDERS[g.provider].hasUsage) continue
    for (const a of g.accounts) {
      const d = stats.get(a.id)?.dashboard
      if (!d) continue
      t.cost += d.today.cost; t.tokens += d.today.tokens
      w.cost += d.week.cost;  w.tokens += d.week.tokens
      m.cost += d.month.cost; m.tokens += d.month.tokens
    }
  }

  const inner = cols - 4
  const dot = glyphs().middot
  const full = `${glyphs().dotAll}  Today ${fmt.currency(t.cost)} (${fmt.tokens(t.tokens)} tok)  ${dot}  Week ${fmt.currency(w.cost)} (${fmt.tokens(w.tokens)} tok)  ${dot}  Month ${fmt.currency(m.cost)} (${fmt.tokens(m.tokens)} tok)`
  const noTok = `${glyphs().dotAll}  Today ${fmt.currency(t.cost)}  ${dot}  Week ${fmt.currency(w.cost)}  ${dot}  Month ${fmt.currency(m.cost)}`
  const tight = `${glyphs().dotAll}  ${fmt.currency(t.cost)}  ${dot}  ${fmt.currency(w.cost)}  ${dot}  ${fmt.currency(m.cost)}`
  const text = full.length <= inner ? full : noTok.length <= inner ? noTok : tight

  return (
    <Box marginTop={1}>
      <Text dimColor>{text}</Text>
    </Box>
  )
})
