import type { DashboardData, UsageSummary } from './types'

export type DashboardSnapshot = DashboardData | null | undefined

const emptyUsageSummary = (): UsageSummary => ({
  cost: 0,
  tokens: 0,
  input: 0,
  cacheRead: 0,
  cacheSavings: 0,
})

function addUsageSummary(target: UsageSummary, source: UsageSummary): void {
  target.cost += source.cost
  target.tokens += source.tokens
  target.input += source.input
  target.cacheRead += source.cacheRead
  target.cacheSavings += source.cacheSavings
}

/**
 * Combines account-level dashboard snapshots into one provider/scope snapshot.
 *
 * Missing snapshots are ignored and an entirely missing scope remains `null`,
 * which lets renderers distinguish "no data yet" from real zero usage. Spark
 * series are aligned at their newest (right-most) bucket so providers that
 * return shorter histories still agree on which point represents today.
 */
export function aggregateDashboardData(snapshots: readonly DashboardSnapshot[]): DashboardData | null {
  const dashboards = snapshots.filter((value): value is DashboardData => value != null)
  if (dashboards.length === 0) return null

  const result: DashboardData = {
    today: emptyUsageSummary(),
    week: emptyUsageSummary(),
    month: emptyUsageSummary(),
    burnRate: 0,
    series: Array.from({ length: Math.max(...dashboards.map(value => value.series.length)) }, () => 0),
    lastActivityAt: null,
  }

  for (const dashboard of dashboards) {
    addUsageSummary(result.today, dashboard.today)
    addUsageSummary(result.week, dashboard.week)
    addUsageSummary(result.month, dashboard.month)
    result.burnRate += dashboard.burnRate

    if (dashboard.lastActivityAt !== null
      && (result.lastActivityAt === null || dashboard.lastActivityAt > result.lastActivityAt)) {
      result.lastActivityAt = dashboard.lastActivityAt
    }

    const offset = result.series.length - dashboard.series.length
    dashboard.series.forEach((value, index) => {
      result.series[offset + index] += value
    })
  }

  return result
}

/** Percentage of total token traffic served from cache, rounded for display. */
export function cachedTokenPercentage(summary: Pick<UsageSummary, 'cacheRead' | 'tokens'>): number {
  if (!Number.isFinite(summary.tokens) || !Number.isFinite(summary.cacheRead) || summary.tokens <= 0) return 0
  return Math.round(Math.min(100, Math.max(0, summary.cacheRead / summary.tokens * 100)))
}
