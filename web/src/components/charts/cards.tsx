import type { Metric, WebAccount } from '@shared'
import type { Derived } from '../../lib/derive'
import { fmtCost, fmtNum, fmtTokens } from '../../lib/format'
import { providerHex, shortModel } from '../../lib/colors'
import { Panel, Sparkline } from '../ui'

export function KpiStrip({ derived, periodLabel }: { derived: Derived; periodLabel: string }) {
  const t = derived.totals
  // Cap to the last 30 points so a 90d/all window doesn't silently clip the oldest.
  const spend = derived.timeline.map(p => p.total).slice(-30)
  const tokens = derived.timeline.map(p => p.tokens).slice(-30)
  const saved = derived.cacheSavingsSeries.map(p => p.value).slice(-30)
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
      <Kpi label={`spend · ${periodLabel}`} value={fmtCost(t.cost)} accent="text-cost" spark={spend} sparkColor="var(--color-cost)" />
      <Kpi label="tokens" value={fmtTokens(t.tokens)} spark={tokens} sparkColor="var(--color-fg-dim)" />
      <Kpi label="cache saved" value={fmtCost(t.cacheSavings)} accent="text-positive" spark={saved} sparkColor="var(--color-positive)" />
      <Kpi label="calls" value={fmtNum(t.calls)} />
      <Kpi label="burn · today" value={`${fmtCost(derived.burnRate)}/hr`} accent="text-warning" />
    </div>
  )
}

function Kpi({ label, value, accent = 'text-fg-bright', spark, sparkColor }: {
  label: string
  value: string
  accent?: string
  spark?: number[]
  sparkColor?: string
}) {
  return (
    <div className="rise flex min-w-0 flex-col rounded-md border border-line bg-bg-1/80 p-3.5 transition-colors hover:border-line-2">
      <div className="font-display text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`tnum mt-1.5 text-xl sm:text-2xl ${accent}`}>{value}</div>
      {spark && spark.length > 1 && (
        <div className="mt-auto overflow-hidden pt-2 text-right">
          <Sparkline data={spark} color={sparkColor ?? 'currentColor'} className="text-sm opacity-70" />
        </div>
      )}
    </div>
  )
}

export function ProviderCards({ accounts, nameOf }: { accounts: WebAccount[]; nameOf: (id: string) => string }) {
  if (accounts.length === 0) {
    return (
      <Panel title="accounts">
        <div className="py-6 text-center text-xs text-fg-faint">no accounts match the current filter</div>
      </Panel>
    )
  }
  return (
    <div className="grid grid-cols-1 justify-center gap-4 sm:grid-cols-[repeat(auto-fit,minmax(340px,460px))]">
      {accounts.map((a, i) => <ProviderCard key={a.id} account={a} index={i} providerName={nameOf(a.providerId)} />)}
    </div>
  )
}

function ProviderCard({ account, index, providerName }: { account: WebAccount; index: number; providerName: string }) {
  const d = account.dashboard
  const metrics = account.billing?.metrics ?? []
  const modelSpend = account.billing?.modelSpend ?? []
  const activity = account.billing?.activity
  // Colored by provider (Claude=green); the account's custom dot color is only an
  // identity signal in multi-account views — matches the TUI.
  const providerColor = providerHex(account.providerId)
  // Provider is the primary identity; the account name is a secondary subtitle,
  // suppressed when it's just the auto-detected provider name (no "Claude · Claude").
  const showSub = account.name && account.name !== providerName
  return (
    <div
      className="rise group relative overflow-hidden rounded-md border bg-bg-1/50 p-4 transition-colors"
      style={{ animationDelay: `${index * 40}ms`, borderColor: `color-mix(in oklab, ${providerColor} 50%, var(--color-line))` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span style={{ color: providerColor }}>●</span>
          <span className="font-display text-sm tracking-wide text-fg-bright">{providerName}</span>
          {showSub && <span className="truncate text-xs text-fg-faint">· {account.name}</span>}
        </div>
        {account.billing?.plan && (
          <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-fg-dim">{account.billing.plan}</span>
        )}
      </div>

      {d && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Mini label="today" cost={d.today.cost} tokens={d.today.tokens} />
            <Mini label="week" cost={d.week.cost} tokens={d.week.tokens} />
            <Mini label="month" cost={d.month.cost} tokens={d.month.tokens} />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line-faint pt-3 text-xs">
            <span className="text-fg-dim">burn <span className="tnum text-warning">{fmtCost(d.burnRate)}/hr</span></span>
            <span className="text-fg-dim">saved <span className="tnum text-positive">{fmtCost(d.month.cacheSavings)}</span></span>
          </div>
        </>
      )}

      {metrics.length > 0 && (
        <div className={`flex flex-col gap-2 ${d ? 'mt-3 border-t border-line-faint pt-3' : 'mt-4'}`}>
          {metrics.slice(0, 8).map(m => <QuotaBar key={m.label} metric={m} />)}
        </div>
      )}

      {modelSpend.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 border-t border-line-faint pt-3">
          <div className="text-[10px] uppercase tracking-wide text-fg-faint">spend by model</div>
          {modelSpend.slice(0, 4).map(m => (
            <div key={m.name} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-fg-dim">{shortModel(m.name)}</span>
              <span className="tnum shrink-0 text-cost">{fmtCost(m.usd)}<span className="ml-1.5 text-fg-faint">{fmtNum(m.requests)} req</span></span>
            </div>
          ))}
        </div>
      )}

      {d && d.series.length > 0 && (
        <div className="mt-3 flex items-center gap-2 border-t border-line-faint pt-3">
          <Sparkline data={d.series} color={providerColor} className="text-sm" />
          <span className="ml-auto text-[10px] text-fg-faint">{d.series.length}d</span>
        </div>
      )}

      {!d && activity && activity.series.length > 0 && (
        <div className="mt-3 flex items-center gap-2 border-t border-line-faint pt-3">
          <Sparkline data={activity.series} color={providerColor} className="text-sm" />
          <span className="ml-auto text-[10px] text-fg-faint">{activity.summary}</span>
        </div>
      )}

      {metrics.length === 0 && account.billing?.error && (
        <div className={`flex items-start gap-1.5 text-xs text-warning ${d ? 'mt-3 border-t border-line-faint pt-3' : 'mt-4'}`}>
          <span aria-hidden>⚠</span><span>{account.billing.error}</span>
        </div>
      )}

      {!d && metrics.length === 0 && !account.billing?.error && modelSpend.length === 0 && !(activity && activity.series.length) && (
        <div className="py-6 text-center text-xs text-fg-faint">{account.hasUsage ? 'no usage data' : 'billing-only · no live metrics'}</div>
      )}
    </div>
  )
}

function Mini({ label, cost, tokens }: { label: string; cost: number; tokens: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-fg-faint">{label}</div>
      <div className="tnum text-sm text-cost">{fmtCost(cost)}</div>
      <div className="tnum text-[10px] text-fg-faint">{fmtTokens(tokens)}</div>
    </div>
  )
}

function fmtMetricValue(m: Metric): string {
  if (m.format.kind === 'dollars') return fmtCost(m.used)
  if (m.format.kind === 'count') return `${fmtNum(m.used)}${m.format.suffix ? ' ' + m.format.suffix : ''}`
  return `${Math.round(m.used)}%`
}

function QuotaBar({ metric }: { metric: Metric }) {
  const ratio = metric.format.kind === 'percent'
    ? Math.min(1, Math.max(0, metric.used / 100))
    : metric.limit != null && metric.limit > 0
      ? Math.min(1, Math.max(0, metric.used / metric.limit))
      : null
  const color = ratio == null
    ? 'var(--color-accent)'
    : ratio >= 0.9 ? 'var(--color-warning)'
    : ratio >= 0.7 ? 'var(--color-cost)'
    : 'var(--color-positive)'
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="truncate text-fg-dim">{metric.label}</span>
        <span className="tnum text-fg">
          {fmtMetricValue(metric)}
          {metric.format.kind !== 'percent' && metric.limit != null && (
            <span className="text-fg-faint">
              {' / '}{metric.format.kind === 'dollars' ? fmtCost(metric.limit) : fmtNum(metric.limit)}
            </span>
          )}
          {metric.resetsAt && <span className="ml-1.5 text-fg-faint">· {metric.resetsAt}</span>}
        </span>
      </div>
      {ratio != null && (
        <div
          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-3"
          role="progressbar"
          aria-label={metric.label}
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full transition-all" style={{ width: `${ratio * 100}%`, background: color }} />
        </div>
      )}
    </div>
  )
}
