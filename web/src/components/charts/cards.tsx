import type { Metric, WebAccount } from '@shared'
import type { Derived } from '../../lib/derive'
import { fmtCost, fmtNum, fmtTokens } from '../../lib/format'
import { Panel, Sparkline } from '../ui'

export function KpiStrip({ derived, periodLabel }: { derived: Derived; periodLabel: string }) {
  const t = derived.totals
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi label={`spend · ${periodLabel}`} value={fmtCost(t.cost)} accent="text-cost" />
      <Kpi label="tokens" value={fmtTokens(t.tokens)} />
      <Kpi label="cache saved" value={fmtCost(t.cacheSavings)} accent="text-positive" />
      <Kpi label="calls" value={fmtNum(t.calls)} />
      <Kpi label="burn · today" value={`${fmtCost(derived.burnRate)}/hr`} accent="text-warning" />
    </div>
  )
}

function Kpi({ label, value, accent = 'text-fg-bright' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rise rounded-md border border-line bg-bg-1/80 p-3.5">
      <div className="font-display text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`tnum mt-1.5 text-2xl ${accent}`}>{value}</div>
    </div>
  )
}

export function ProviderCards({ accounts }: { accounts: WebAccount[] }) {
  if (accounts.length === 0) {
    return <Panel title="accounts"><div className="py-6 text-center text-xs text-fg-faint">no accounts match the current filter</div></Panel>
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {accounts.map((a, i) => <ProviderCard key={a.id} account={a} index={i} />)}
    </div>
  )
}

function ProviderCard({ account, index }: { account: WebAccount; index: number }) {
  const d = account.dashboard
  const metrics = account.billing?.metrics ?? []
  return (
    <div
      className="rise group relative overflow-hidden rounded-md border bg-bg-1/50 p-4 transition-colors"
      style={{ animationDelay: `${index * 40}ms`, borderColor: `color-mix(in oklab, ${account.color} 50%, var(--color-line))` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span style={{ color: account.color }}>●</span>
          <span className="font-display text-sm tracking-wide text-fg-bright">{account.name}</span>
        </div>
        {account.billing?.plan && <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-fg-dim">{account.billing.plan}</span>}
      </div>

      {d ? (
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
          {metrics.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 border-t border-line-faint pt-3">
              {metrics.slice(0, 3).map((m, i) => <QuotaBar key={i} metric={m} />)}
            </div>
          )}
          {d.series.length > 0 && (
            <div className="mt-3 flex items-center gap-2 border-t border-line-faint pt-3">
              <Sparkline data={d.series} color={account.color} className="text-sm" />
              <span className="ml-auto text-[10px] text-fg-faint">{d.series.length}d</span>
            </div>
          )}
        </>
      ) : (
        <div className="py-6 text-center text-xs text-fg-faint">no usage data</div>
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
  const color = ratio == null ? 'var(--color-accent)' : ratio >= 0.9 ? 'var(--color-warning)' : ratio >= 0.7 ? 'var(--color-cost)' : 'var(--color-positive)'
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="truncate text-fg-dim">{metric.label}</span>
        <span className="tnum text-fg">
          {fmtMetricValue(metric)}
          {metric.format.kind !== 'percent' && metric.limit != null && <span className="text-fg-faint"> / {metric.format.kind === 'dollars' ? fmtCost(metric.limit) : fmtNum(metric.limit)}</span>}
          {metric.resetsAt && <span className="ml-1.5 text-fg-faint">· {metric.resetsAt}</span>}
        </span>
      </div>
      {ratio != null && (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-3">
          <div className="h-full rounded-full transition-all" style={{ width: `${ratio * 100}%`, background: color }} />
        </div>
      )}
    </div>
  )
}
