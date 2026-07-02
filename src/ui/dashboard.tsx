import { memo } from 'react'
import { Box, Text } from 'ink'
import * as fmt from '../format'
import { PROVIDERS } from '../providers'
import type { Account, BillingResult, Metric, ProviderId } from '../providers/types'
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

// Estimate each provider card's natural full-variant height so the layout can
// budget for real content (cards grow with accounts × metrics) instead of the
// fixed CARD_H, which clipped multi-account cards inside the overflow box.
export function estimateCardHeights(
  groups: { provider: ProviderId; accounts: Account[] }[],
  stats: Map<string, AccountStats>,
): number[] {
  return groups.map(g => {
    const meta = PROVIDERS[g.provider]
    let h = 3 // borders + title row
    if (meta.hasUsage) h += 5 // spacer + 3 summary rows + kpi line
    if (meta.hasBilling) {
      if (meta.hasUsage) h += 1 // rule
      const multi = g.accounts.length > 1
      g.accounts.forEach((a, i) => {
        const metricRows = stats.get(a.id)?.billing?.metrics.length || 1
        h += metricRows + (multi ? 1 : 0) + (multi && i > 0 ? 1 : 0) // name row + gap between accounts
      })
    }
    h += 2 // spark/activity footer (rule + row)
    return Math.max(h, CARD_H.mini)
  })
}

export function chooseLayout(content: number, budget: number, n: number, single: boolean, cols: number, heights?: number[]): GridLayout {
  if (n <= 0) return { ncols: 1, variant: 'mini', cardsPerPage: 1, pageCount: 1 }

  const heightFor = (variant: Variant): number => {
    if (!heights || heights.length === 0) return CARD_H[variant]
    if (variant === 'mini') return CARD_H.mini
    const hs = heights.map(h => variant === 'full' ? h : Math.max(h - 2, CARD_H.mini - 2))
    return Math.max(...hs)
  }
  const gridHeight = (rows: number, H: number) => rows * H + Math.max(0, rows - 1)

  const colCap = single ? 1
    : cols >= 3 * MIN_CARD_DENSE + 2 * GAP ? 3
    : cols >= 2 * MIN_CARD + GAP ? 2
    : 1
  const maxCols = Math.max(1, Math.min(colCap, n))
  const cardWidthAt = (nc: number) => nc <= 1 ? content : Math.floor((content - GAP * (nc - 1)) / nc)
  const minWidthAt = (nc: number) => nc >= 3 ? MIN_CARD_DENSE : MIN_CARD

  for (const variant of VARIANT_ORDER) {
    const H = heightFor(variant)
    for (let nc = maxCols; nc >= 1; nc--) {
      if (nc > 1 && cardWidthAt(nc) < minWidthAt(nc)) continue
      const rows = Math.ceil(n / nc)
      if (gridHeight(rows, H) <= budget) {
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

// Single source of truth for the dashboard grid — used by both the view and the
// key-handling layer in app.tsx so page counts can't drift apart.
export function computeDashLayout(
  groups: { provider: ProviderId; accounts: Account[] }[],
  stats: Map<string, AccountStats>,
  cols: number,
  budget: number,
  focusId: string | null,
  layoutPref: 'grid' | 'single',
): GridLayout {
  const content = Math.max(30, cols - 4)
  const heights = estimateCardHeights(groups, stats)
  const single = focusId !== null || layoutPref === 'single'
  if (layoutPref === 'single' && focusId === null && groups.length > 1) {
    // "Single" with All focus pages through providers one card at a time.
    const one = chooseLayout(content, budget, 1, true, cols, [Math.max(...heights)])
    return { ...one, cardsPerPage: 1, pageCount: groups.length }
  }
  return chooseLayout(content, budget, groups.length, single, cols, heights)
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

  const content = Math.max(30, cols - 4)
  const { ncols, variant, cardsPerPage, pageCount } = computeDashLayout(groups, stats, cols, budget, focusId, layout)

  let cardW = ncols <= 1 ? content : Math.floor((content - GAP * (ncols - 1)) / ncols)
  if (ncols === 1 && cardW > MAX_SINGLE_CARD) cardW = MAX_SINGLE_CARD

  const pg = pageCount > 1 ? ((page % pageCount) + pageCount) % pageCount : 0
  const visible = pageCount > 1
    ? groups.slice(pg * cardsPerPage, pg * cardsPerPage + cardsPerPage)
    : groups

  return (
    <Box height={budget} flexDirection="column" overflow="hidden">
      <Box width={content} flexWrap="wrap" columnGap={GAP} rowGap={1} alignItems="flex-start">
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
          <LimitsBlock items={items} inner={inner} />
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
  const m = billing.metrics.find(x => x.primary) ?? billing.metrics[0]
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

function accountTitle(account: Account, billing: BillingResult | null | undefined): string {
  const email = billing?.email
  return email && !account.name.includes('@') ? `${account.name} ${email}` : account.name
}

function LimitsBlock({ items, inner }: { items: Item[]; inner: number }) {
  const showName = items.length > 1
  // Shared label gutter so values/bars align across every metric row in the card.
  const labels = items.flatMap(i => i.s?.billing?.metrics ?? []).map(m => m.label.length)
  const labelW = Math.min(Math.max(7, ...labels) + 1, 14)
  const barW = Math.max(10, Math.min(46, inner - labelW - 13))
  return (
    <Box flexDirection="column">
      {items.map(({ account, s }, idx) => {
        const billing = s?.billing
        return (
          <Box key={account.id} flexDirection="column" marginTop={showName && idx > 0 ? 1 : 0}>
            {showName && (
              <Box><Text color={account.color}>{glyphs().dot} </Text><Text bold>{truncateName(accountTitle(account, billing), Math.max(22, inner - 2))}</Text></Box>
            )}
            {!billing ? (
              <Text dimColor>Fetching{glyphs().ellipsis}</Text>
            ) : billing.error ? (
              <Text color="red" wrap="truncate-end">{billing.error}</Text>
            ) : billing.metrics.length === 0 ? (
              <Text dimColor>No data</Text>
            ) : (
              billing.metrics.map((m, i) => <MetricRow key={`${m.label}${i}`} m={m} color={account.color} barW={barW} labelW={labelW} />)
            )}
          </Box>
        )
      })}
    </Box>
  )
}

function MetricRow({ m, color, barW, labelW }: { m: Metric; color: string; barW: number; labelW: number }) {
  if (m.format.kind === 'percent') {
    const barColor = m.used >= 90 ? 'red' : m.used >= 75 ? 'yellow' : color
    return (
      <Box>
        <Box width={labelW} flexShrink={0}><Text dimColor wrap="truncate">{m.label}</Text></Box>
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
      <Box width={labelW} flexShrink={0}><Text dimColor wrap="truncate">{m.label}</Text></Box>
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
