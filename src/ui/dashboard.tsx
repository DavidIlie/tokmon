import { memo } from 'react'
import { Box, Text } from 'ink'
import * as fmt from './format'
import { PROVIDERS } from '../providers'
import type { Account, ProviderId } from '../providers/types'
import type { UsageSummary, DashboardData } from '../types'
import type { AccountStats } from '../stats'
import { Bar, sparkline, truncateName } from './shared'
import { glyphs } from './glyphs'
import { redactEmail } from '../config'
import { planDisplay, normalizePlan, billingStaleLabel } from './provider-card.logic'
import { resolveQuotaViews, severity, usageFromHeadroom, type QuotaView } from '../usage-semantics'
import { resolveAccountTitle } from './app-layout.logic'
import { aggregateDashboardData, cachedTokenPercentage } from '../dashboard-data'
import { useTuiTheme } from './theme'

type Item = { account: Account; s: AccountStats | undefined }

/** Map the shared availability band to a terminal colour, keeping the ≤10/≤25
 * thresholds single-sourced in `severity()`. `base` is the non-urgent colour
 * (provider hue / bar colour) shown for ok/unknown. */
function severityColor(
  remaining: number | null,
  crit: string | undefined,
  warn: string | undefined,
  base: string | undefined,
): string | undefined {
  const level = severity(remaining)
  return level === 'crit' ? crit : level === 'warn' ? warn : base
}

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
        const s = stats.get(a.id)
        const staleRow = s?.billing && !s.billing.error && quotaViews(s).length > 0
          && billingStaleLabel(s.billing.asOfMs ?? s.billingUpdatedAt, Date.now()) ? 1 : 0
        const metricRows = (quotaViews(s).length || 1) + staleRow
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

export const DashboardView = memo(function DashboardView({ groups, stats, cols, budget, computed, page = 0, privacyMode = false, privacyLabels, resetDisplay = 'relative', tz }: {
  groups: { provider: ProviderId; accounts: Account[] }[]
  stats: Map<string, AccountStats>
  cols: number
  budget: number
  /** Layout computed once by the app root (single source of truth for the view
   * and the key-handling layer); the view no longer recomputes it. */
  computed: GridLayout
  page?: number
  privacyMode?: boolean
  /** Shared strict privacy projection, keyed by account id (see derivePrivacyLabels). */
  privacyLabels?: ReadonlyMap<string, string>
  resetDisplay?: 'relative' | 'absolute'
  tz?: string
}) {
  if (groups.length === 0) {
    return <Text dimColor>No providers enabled {glyphs().emDash} press s to pick providers.</Text>
  }

  const content = Math.max(30, cols - 4)
  const { ncols, variant, cardsPerPage, pageCount } = computed

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
            <ProviderCard provider={g.provider} accounts={g.accounts} stats={stats} width={cardW} variant={variant} privacyMode={privacyMode} privacyLabels={privacyLabels} resetDisplay={resetDisplay} tz={tz} />
          </Box>
        ))}
      </Box>
      {pageCount > 1 && (
        <Text dimColor>  {glyphs().middot} page {pg + 1}/{pageCount} {glyphs().middot} scroll {glyphs().arrowU}{glyphs().arrowD}</Text>
      )}
    </Box>
  )
})

function ProviderCard({ provider, accounts, stats, width, variant, privacyMode = false, privacyLabels, resetDisplay, tz }: {
  provider: ProviderId
  accounts: Account[]
  stats: Map<string, AccountStats>
  width: number
  variant: Variant
  privacyMode?: boolean
  privacyLabels?: ReadonlyMap<string, string>
  resetDisplay: 'relative' | 'absolute'
  tz?: string
}) {
  const theme = useTuiTheme()
  const meta = PROVIDERS[provider]
  const items: Item[] = accounts.map(a => ({ account: a, s: stats.get(a.id) }))
  const agg = meta.hasUsage ? aggregateDashboardData(items.map(i => i.s?.dashboard)) : null
  const planView = planDisplay(items.map(i => i.s?.billing?.plan))
  const activity = items.map(i => i.s?.billing?.activity).find(Boolean) ?? null
  const inner = width - 4
  const hasSpark = !!agg && agg.series.some(v => v > 0)
  const showBars = variant !== 'mini'
  const showSpark = variant === 'full'
  const headroom = items.find(item => item.s?.providerHeadroom)?.s?.providerHeadroom

  return (
    <Box flexDirection="column" width={width} borderStyle={glyphs().border} borderColor={meta.color} paddingX={1}>
      <Box>
        <Text color={meta.color}>{glyphs().dot} </Text>
        <Text bold color={meta.color}>{meta.name}</Text>
        <Box flexGrow={1} />
        {planView.mode === 'header' && <Text dimColor>{planView.plan}</Text>}
        {planView.mode === 'perRow' && <Text dimColor>{planView.count} accounts</Text>}
      </Box>
      {headroom?.value != null && (
        <Box>
          <Text dimColor>Usage </Text><Text bold color={severityColor(headroom.value, theme.crit, theme.warn, meta.color)}>{Math.round(usageFromHeadroom(headroom.value)!)}%</Text>
        </Box>
      )}

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
          <LimitsBlock items={items} inner={inner} showRowPlans={planView.mode === 'perRow'} privacyMode={privacyMode} privacyLabels={privacyLabels} resetDisplay={resetDisplay} tz={tz} providerName={meta.name} />
        </>
      )}
      {meta.hasBilling && !showBars && !meta.hasUsage && (
        <CompactBilling items={items} privacyMode={privacyMode} />
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
            <Text color={meta.color}>{sparkline(activity.series.slice(-14))}</Text>
            <Box flexGrow={1} justifyContent="flex-end"><Text dimColor>{activity.summary}</Text></Box>
          </Box>
        </>
      )}
    </Box>
  )
}

function CompactBilling({ items, privacyMode }: { items: Item[]; privacyMode?: boolean }) {
  const theme = useTuiTheme()
  const stats = items.map(item => item.s).find(value => value?.billing)
  const billing = stats?.billing
  if (!billing) return <Text dimColor>Fetching{glyphs().ellipsis}</Text>
  if (billing.error) return <Text color={theme.crit}>{privacyMode ? redactEmail(billing.error) : billing.error}</Text>
  const quotas = quotaViews(stats)
  const quota = quotas.find(value => value.primary) ?? quotas[0]
  if (!quota) return <Text dimColor>No data</Text>
  return <Text bold color={theme.cost}>{quota.valueText}</Text>
}

function Rule({ inner }: { inner: number }) {
  return <Text dimColor>{glyphs().rule.repeat(Math.max(0, inner))}</Text>
}

function SummaryRow({ label, s }: { label: string; s: UsageSummary }) {
  const theme = useTuiTheme()
  const cachedPct = cachedTokenPercentage(s)
  return (
    <Box>
      <Box width={11} flexShrink={0}><Text dimColor wrap="truncate">{label}</Text></Box>
      <Box width={11} flexShrink={0} justifyContent="flex-end"><Text bold color={theme.cost} wrap="truncate">{fmt.currency(s.cost)}</Text></Box>
      <Box width={13} flexShrink={0} justifyContent="flex-end"><Text dimColor wrap="truncate">{fmt.tokens(s.tokens)} tok</Text></Box>
      <Box flexGrow={1} justifyContent="flex-end">
        {cachedPct > 0 ? <Text dimColor wrap="truncate">{cachedPct}% cached</Text> : <Text> </Text>}
      </Box>
    </Box>
  )
}

function KpiLine({ agg }: { agg: DashboardData }) {
  const theme = useTuiTheme()
  const hasBurn = agg.burnRate > 0
  const hasSaved = agg.month.cacheSavings > 0
  if (!hasBurn && !hasSaved) return null
  return (
    <Box>
      {hasBurn && <><Text dimColor>Burn </Text><Text color={theme.crit}>{fmt.currency(agg.burnRate)}/hr</Text></>}
      <Box flexGrow={1} />
      {hasSaved && <><Text dimColor>Cache saved </Text><Text color={theme.positive}>{fmt.currency(agg.month.cacheSavings)}/mo</Text></>}
    </Box>
  )
}

function LimitsBlock({ items, inner, showRowPlans, privacyMode, privacyLabels, resetDisplay, tz, providerName }: {
  items: Item[]
  inner: number
  showRowPlans: boolean
  privacyMode?: boolean
  privacyLabels?: ReadonlyMap<string, string>
  resetDisplay: 'relative' | 'absolute'
  tz?: string
  providerName: string
}) {
  const theme = useTuiTheme()
  const showName = items.length > 1
  // Shared label gutter so values/bars align across every metric row in the card.
  const labels = items.flatMap(i => quotaViews(i.s)).map(quota => quota.label.length)
  const labelW = Math.min(Math.max(7, ...labels) + 1, 14)
  const resetW = resetDisplay === 'absolute' ? 17 : 8
  const barW = Math.max(10, Math.min(46, inner - labelW - resetW - 5))
  return (
    <Box flexDirection="column">
      {items.map(({ account, s }, idx) => {
        const billing = s?.billing
        const quotas = quotaViews(s)
        const staleLabel = billing && !billing.error && quotas.length > 0
          ? billingStaleLabel(billing.asOfMs ?? s?.billingUpdatedAt, Date.now())
          : null
        return (
          <Box key={account.id} flexDirection="column" marginTop={showName && idx > 0 ? 1 : 0}>
            {showName && (() => {
              const rowPlan = showRowPlans ? normalizePlan(billing?.plan) : null
              // Reserve the plan column off the name budget so name (left) and plan (right) never collide/wrap.
              // planCap guarantees the name floor (22) still fits even if a plan were pathologically long:
              //   dot(2) + nameFloor(22) + gap(1) + planCap <= inner  ⇒  planCap = inner - 25.
              // planCap < 4 can't hold an ASCII ellipsis without overflowing the row — drop the plan there.
              const planCap = Math.max(0, inner - 25)
              const shownPlan = rowPlan && planCap >= 4 ? truncateName(rowPlan, planCap) : ''
              const planReserve = shownPlan ? shownPlan.length + 1 : 0 // +1 for the gap before the plan
              const nameBudget = Math.max(22, inner - 2 - planReserve) // -2 for the "• " dot glyph
              const title = resolveAccountTitle({
                name: account.name, email: billing?.email, identity: s?.identity, providerName,
                privacyMode: privacyMode === true, privacyLabel: privacyLabels?.get(account.id),
              })
              return (
                <Box>
                  <Text color={account.color}>{glyphs().dot} </Text>
                  <Text bold>{truncateName(title, nameBudget)}</Text>
                  {shownPlan && <><Box flexGrow={1} /><Text dimColor>{shownPlan}</Text></>}
                </Box>
              )
            })()}
            {!billing ? (
              <Text dimColor>Fetching{glyphs().ellipsis}</Text>
            ) : billing.error ? (
              <Text color={theme.crit} wrap="truncate-end">{privacyMode ? redactEmail(billing.error) : billing.error}</Text>
            ) : quotas.length === 0 ? (
              <Text dimColor>No data</Text>
            ) : (
              quotas.map(quota => <QuotaRow key={quota.key} quota={quota} color={account.color} barW={barW} labelW={labelW} resetW={resetW} resetDisplay={resetDisplay} tz={tz} />)
            )}
            {staleLabel && <Text color={theme.warn} dimColor>{glyphs().warn} {staleLabel} {glyphs().middot} refreshing{glyphs().ellipsis}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

/** Current snapshots carry canonical quotas; derive only at the old-snapshot boundary. */
function quotaViews(stats: AccountStats | undefined): QuotaView[] {
  return resolveQuotaViews({ quotas: stats?.quotas, metrics: stats?.billing?.metrics })
}

function QuotaRow({ quota, color, barW, labelW, resetW, resetDisplay, tz }: {
  quota: QuotaView
  color: string
  barW: number
  labelW: number
  resetW: number
  resetDisplay: 'relative' | 'absolute'
  tz?: string
}) {
  const theme = useTuiTheme()
  if (quota.value?.kind === 'money') {
    return (
      <Box>
        <Box width={labelW} flexShrink={0}><Text dimColor wrap="truncate">{quota.label}</Text></Box>
        <Text bold color={theme.cost} wrap="truncate-end">{quota.valueText}</Text>
      </Box>
    )
  }
  if (quota.bounded && quota.usedPct !== null) {
    const used = quota.usedPct
    const remaining = quota.remainingPct ?? 0
    const barColor = severityColor(remaining, theme.crit, theme.warn, color)
    return (
      <Box>
        <Box width={labelW} flexShrink={0}><Text dimColor wrap="truncate">{quota.label}</Text></Box>
        <Bar pct={used} color={barColor} width={barW} />
        <Box width={5} justifyContent="flex-end"><Text bold>{Math.round(used)}%</Text></Box>
        <Box width={resetW} justifyContent="flex-end">
          {quota.resetsAt ? <Text dimColor>{fmt.resetAt(new Date(quota.resetsAt).toISOString(), resetDisplay, Date.now(), tz)}</Text> : <Text> </Text>}
        </Box>
      </Box>
    )
  }
  return (
    <Box>
      <Box width={labelW} flexShrink={0}><Text dimColor wrap="truncate">{quota.label}</Text></Box>
      <Text bold color={theme.cost}>{quota.valueText}</Text>
    </Box>
  )
}

function SparkFooter({ series, month, color }: { series: number[]; month: number; color: string }) {
  return (
    <Box>
      <Box width={4}><Text dimColor>14d</Text></Box>
      <Text color={color}>{sparkline(series.slice(-14))}</Text>
      <Box flexGrow={1} justifyContent="flex-end"><Text dimColor>{fmt.currency(month)} mo</Text></Box>
    </Box>
  )
}

export const TotalsRow = memo(function TotalsRow({ groups, stats, cols }: {
  groups: { provider: ProviderId; accounts: Account[] }[]
  stats: Map<string, AccountStats>
  cols: number
}) {
  const aggregate = aggregateDashboardData(groups.flatMap(group => (
    PROVIDERS[group.provider].hasUsage
      ? group.accounts.map(account => stats.get(account.id)?.dashboard)
      : []
  )))
  const t = aggregate?.today ?? { cost: 0, tokens: 0, input: 0, cacheRead: 0, cacheSavings: 0 }
  const w = aggregate?.week ?? { cost: 0, tokens: 0, input: 0, cacheRead: 0, cacheSavings: 0 }
  const m = aggregate?.month ?? { cost: 0, tokens: 0, input: 0, cacheRead: 0, cacheSavings: 0 }

  const inner = cols - 4
  const dot = glyphs().middot
  const monthNonCached = m.input > 0 ? `, ${fmt.tokens(m.input)} non-cached` : ''
  const full = `${glyphs().dotAll}  Today ${fmt.currency(t.cost)} (${fmt.tokens(t.tokens)} tok)  ${dot}  Week ${fmt.currency(w.cost)} (${fmt.tokens(w.tokens)} tok)  ${dot}  Month ${fmt.currency(m.cost)} (${fmt.tokens(m.tokens)} tok${monthNonCached})`
  const monthOnly = `${glyphs().dotAll}  This Month ${fmt.currency(m.cost)} (${fmt.tokens(m.tokens)} tok${monthNonCached})`
  const noTok = `${glyphs().dotAll}  Today ${fmt.currency(t.cost)}  ${dot}  Week ${fmt.currency(w.cost)}  ${dot}  Month ${fmt.currency(m.cost)}${m.input > 0 ? ` (${fmt.tokens(m.input)} non-cached)` : ''}`
  const tight = `${glyphs().dotAll}  ${fmt.currency(t.cost)}  ${dot}  ${fmt.currency(w.cost)}  ${dot}  ${fmt.currency(m.cost)}`
  const text = full.length <= inner ? full : monthOnly.length <= inner ? monthOnly : noTok.length <= inner ? noTok : tight

  return (
    <Box marginTop={1}>
      <Text dimColor>{text}</Text>
    </Box>
  )
})
