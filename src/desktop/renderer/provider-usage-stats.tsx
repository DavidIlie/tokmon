import React, { memo, useMemo } from 'react'
import { aggregateDashboardData, cachedTokenPercentage } from '../../dashboard-data'
import { formatCurrency, formatTokens } from '../../shared/format'
import type { UsageSummary } from '../../types'
import type { WebAccount } from '../../web/contract'

interface ProviderUsageStatsProps {
  accounts: readonly WebAccount[]
  providerName: string
  intervalMs: number
  now: number
}

const PERIODS = [
  ['today', 'Today'],
  ['week', 'This Week'],
  ['month', 'This Month'],
] as const

function hasUsage(summary: UsageSummary): boolean {
  return summary.cost !== 0 || summary.tokens !== 0
}

function sparkPoints(values: readonly number[], width: number, height: number): string {
  const clean = values.map(value => Number.isFinite(value) ? Math.max(0, value) : 0)
  const max = Math.max(...clean, 0)
  if (clean.length === 0 || max === 0) return ''
  const step = clean.length > 1 ? width / (clean.length - 1) : 0
  return clean.map((value, index) => {
    const x = clean.length > 1 ? index * step : width / 2
    const y = height - 1 - (value / max) * (height - 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

function dataStatus(accounts: readonly WebAccount[], intervalMs: number, now: number): string | null {
  const usageAccounts = accounts.filter(account => account.hasUsage)
  const missing = usageAccounts.some(account => account.dashboard === null)
  const failed = usageAccounts.some(account => account.summaryState === 'error')
  const staleAfterMs = Math.max(300_000, intervalMs * 2)
  const stale = usageAccounts.some(account => account.dashboard !== null
    && account.summaryUpdatedAt !== null
    && now - account.summaryUpdatedAt > staleAfterMs)
  if (missing) return failed ? 'Partial usage data · refresh failed' : 'Partial usage data'
  if (failed || stale) return 'Usage data may be outdated'
  return null
}

export const ProviderUsageStats = memo(function ProviderUsageStats({ accounts, providerName, intervalMs, now }: ProviderUsageStatsProps) {
  const dashboard = useMemo(
    () => aggregateDashboardData(accounts.map(account => account.dashboard)),
    [accounts],
  )
  if (!dashboard || !PERIODS.some(([key]) => hasUsage(dashboard[key]))) return null

  const status = dataStatus(accounts, intervalMs, now)
  const showBurn = dashboard.burnRate > 0
  const showSavings = dashboard.month.cacheSavings > 0
  const points = sparkPoints(dashboard.series, 180, 20)
  const sparkLabel = `${providerName} 14-day spend activity`

  return (
    <section className="provider-usage-stats" aria-label={`${providerName} token usage and spend`}>
      {status && <p className="usage-data-status" role="status">{status}</p>}
      <dl className="usage-periods">
        {PERIODS.map(([key, label]) => {
          const summary = dashboard[key]
          const cached = cachedTokenPercentage(summary)
          return (
            <div className="usage-period" data-period={key} key={key}>
              <dt>{label}</dt>
              <dd className="usage-period__cost">{formatCurrency(summary.cost)}</dd>
              <dd className="usage-period__tokens">{formatTokens(summary.tokens)} tokens</dd>
              {cached > 0 && <dd className="usage-period__cached">{cached}% cached</dd>}
            </div>
          )
        })}
      </dl>

      {(showBurn || showSavings) && (
        <dl className="usage-kpis">
          {showBurn && <div><dt>Burn</dt><dd>{formatCurrency(dashboard.burnRate)}/hr</dd></div>}
          {showSavings && <div><dt>Cache saved</dt><dd>{formatCurrency(dashboard.month.cacheSavings)}/mo</dd></div>}
        </dl>
      )}

      {points && (
        <div className="usage-spark">
          <span>14d</span>
          <svg
            viewBox="0 0 180 20" preserveAspectRatio="none" role="img"
            aria-label={sparkLabel}
          >
            <title>{sparkLabel}</title>
            <polyline points={points} vectorEffect="non-scaling-stroke" />
          </svg>
          <span>{formatCurrency(dashboard.month.cost)}/mo</span>
        </div>
      )}
    </section>
  )
})
