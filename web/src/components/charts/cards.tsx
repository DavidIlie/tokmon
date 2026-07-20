import { severity, usageFromHeadroom, type AppearanceConfig, type QuotaView, type Severity, type WebAccount } from '@shared'
import type { Derived } from '../../lib/derive'
import { fmtCost, fmtNum, fmtResetAt, fmtTokens } from '../../lib/format'
import { providerHex, shortModel } from '../../lib/colors'
import { Panel } from '../ui/panel'
import { Sparkline } from '../ui/primitives'
import { PrivacyLabel, privacyText } from '../privacy-label'
import { accountIdentityText } from '../../lib/account-identity'
import { dataInkColor, usesAccentInk } from '../../lib/theme-visualization'
import { useTheme } from '../theme-provider'

// Severity → visual tokens. The ≤10/≤25 thresholds live once in `severity()`;
// these maps only bind the shared band to this surface's classes/vars.
const SEV_TEXT: Record<Severity, string> = { unknown: 'text-fg', ok: 'text-ok', warn: 'text-warning', crit: 'text-critical' }
const SEV_BAR: Record<Severity, string> = {
  unknown: 'var(--color-accent)',
  ok: 'var(--color-ok)',
  warn: 'var(--color-warning)',
  crit: 'var(--color-critical)',
}

export function KpiStrip({ derived, periodLabel }: { derived: Derived; periodLabel: string }) {
  const theme = useTheme()
  const themedSpark = usesAccentInk(theme.appearance.preset) ? 'var(--color-accent)' : undefined
  const t = derived.totals
  const spend = derived.timeline.map(p => p.total).slice(-30)
  const tokens = derived.timeline.map(p => p.tokens).slice(-30)
  const saved = derived.cacheSavingsSeries.map(p => p.value).slice(-30)
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
      <Kpi label={`spend · ${periodLabel}`} value={fmtCost(t.cost)} accent="text-cost" spark={spend} sparkColor={themedSpark ?? 'var(--color-cost)'} />
      <Kpi label="tokens" value={fmtTokens(t.tokens)} spark={tokens} sparkColor={themedSpark ?? 'var(--color-fg-dim)'} />
      <Kpi label="cache saved" value={fmtCost(t.cacheSavings)} accent="text-positive" spark={saved} sparkColor={themedSpark ?? 'var(--color-positive)'} />
      <Kpi label="calls" value={fmtNum(t.calls)} />
      <Kpi label="burn · today" value={`${fmtCost(derived.burnRate)}/hr`} accent="text-critical" />
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

export function ProviderCards({ accounts, nameOf, privacyMode, resetDisplay, tz }: {
  accounts: WebAccount[]
  nameOf: (id: string) => string
  privacyMode: boolean
  resetDisplay: 'relative' | 'absolute'
  tz: string
}) {
  const theme = useTheme()
  const preset = theme.appearance.preset
  if (accounts.length === 0) {
    return (
      <Panel title="accounts">
        <div className="py-6 text-center text-xs text-fg-faint">no accounts match the current filter</div>
      </Panel>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))]">
      {accounts.map((a, i) => <ProviderCard key={a.id} account={a} index={i} preset={preset} providerName={nameOf(a.providerId)} privacyMode={privacyMode} resetDisplay={resetDisplay} tz={tz} />)}
    </div>
  )
}

function ProviderCard({ account, index, preset, providerName, privacyMode, resetDisplay, tz }: {
  account: WebAccount
  index: number
  preset: AppearanceConfig['preset']
  providerName: string
  privacyMode: boolean
  resetDisplay: 'relative' | 'absolute'
  tz: string
}) {
  const d = account.dashboard
  const metrics = account.quotas ?? []
  const modelSpend = account.billing?.modelSpend ?? []
  const activity = account.billing?.activity
  const providerColor = dataInkColor(preset, index, providerHex(account.providerId))
  const identity = accountIdentityText(account, providerName)
  const showSub = identity !== providerName
  return (
    <div
      className="rise group relative overflow-hidden rounded-md border bg-bg-1/50 p-4 transition-colors"
      style={{ animationDelay: `${index * 40}ms`, borderColor: `color-mix(in oklab, ${providerColor} 50%, var(--color-line))` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span style={{ color: providerColor }}>●</span>
          <span className="font-display text-sm tracking-wide text-fg-bright">{providerName}</span>
          {showSub && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-fg-faint">
              <span aria-hidden>·</span>
              {account.identity
                ? <span className="truncate text-fg-faint" title={account.identity.accessibleLabel}>{identity}</span>
                : <PrivacyLabel value={identity} privacyMode={privacyMode} className="truncate text-fg-faint" />}
            </span>
          )}
        </div>
        {account.billing?.plan && (
          <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-fg-dim">{account.billing.plan}</span>
        )}
      </div>

      {account.headroom?.value != null && (() => {
        const usage = usageFromHeadroom(account.headroom.value)!
        const level = SEV_TEXT[severity(account.headroom.value)]
        return (
        <div className="mt-3 flex items-baseline justify-between rounded border border-line-faint bg-bg-0/35 px-2.5 py-2">
          <span className="text-[10px] uppercase tracking-wide text-fg-faint">usage</span>
          <span className={`tnum text-sm font-semibold ${level}`}>{Math.round(usage)}% used</span>
        </div>
        )
      })()}

      {d && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Mini label="today" cost={d.today.cost} tokens={d.today.tokens} />
            <Mini label="week" cost={d.week.cost} tokens={d.week.tokens} />
            <Mini label="month" cost={d.month.cost} tokens={d.month.tokens} />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line-faint pt-3 text-xs">
            <span className="text-fg-dim">burn <span className="tnum text-critical">{fmtCost(d.burnRate)}/hr</span></span>
            <span className="text-fg-dim">saved <span className="tnum text-positive">{fmtCost(d.month.cacheSavings)}</span></span>
          </div>
        </>
      )}

      {metrics.length > 0 && (
        <div className={`flex flex-col gap-2 ${d ? 'mt-3 border-t border-line-faint pt-3' : 'mt-4'}`}>
          {metrics.slice(0, 8).map((quota) => <QuotaBar key={quota.key} quota={quota} resetDisplay={resetDisplay} tz={tz} />)}
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
          <Sparkline data={d.series.slice(-14)} color={providerColor} className="text-sm" />
          <span className="ml-auto text-[10px] text-fg-faint">{Math.min(14, d.series.length)}d</span>
        </div>
      )}

      {!d && activity && activity.series.length > 0 && (
        <div className="mt-3 flex items-center gap-2 border-t border-line-faint pt-3">
          <Sparkline data={activity.series.slice(-14)} color={providerColor} className="text-sm" />
          <span className="ml-auto text-[10px] text-fg-faint">{activity.summary}</span>
        </div>
      )}

      {metrics.length === 0 && account.billing?.error && (
        <div className={`flex items-start gap-1.5 text-xs text-critical ${d ? 'mt-3 border-t border-line-faint pt-3' : 'mt-4'}`}>
          <span aria-hidden>⚠</span><span>{privacyText(account.billing.error, privacyMode)}</span>
        </div>
      )}

      {!d && metrics.length === 0 && !account.billing?.error && modelSpend.length === 0 && !(activity && activity.series.length) && (
        <div className="py-6 text-center text-xs text-fg-faint">{account.hasUsage ? 'no usage data' : 'billing-only · no live metrics'}</div>
      )}
    </div>
  )
}

function Mini({ label, cost, tokens }: { label: string; cost: number; tokens: number }) {
  const costLed = cost > 0 || tokens === 0
  return (
    <div>
      <div className="text-[10px] uppercase text-fg-faint">{label}</div>
      <div className={`tnum text-sm ${costLed ? 'text-cost' : 'text-fg-bright'}`}>{costLed ? fmtCost(cost) : fmtTokens(tokens)}</div>
      <div className="tnum text-[10px] text-fg-faint">{costLed ? fmtTokens(tokens) : fmtCost(cost)}</div>
    </div>
  )
}

function QuotaBar({ quota, resetDisplay, tz }: { quota: QuotaView; resetDisplay: 'relative' | 'absolute'; tz: string }) {
  const ratio = quota.usedPct == null ? null : Math.min(1, Math.max(0, quota.usedPct / 100))
  // severity(null) → 'unknown' → accent, matching the prior explicit null case.
  const color = SEV_BAR[severity(quota.remainingPct)]
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="truncate text-fg-dim">{quota.label}</span>
        <span className="tnum text-fg">
          {quota.valueText}
          {quota.resetsAt && <span className="ml-1.5 text-fg-faint">· {fmtResetAt(new Date(quota.resetsAt).toISOString(), resetDisplay, Date.now(), tz)}</span>}
        </span>
      </div>
      {ratio != null && (
        <div
          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-3"
          role="progressbar"
          aria-label={`${quota.label} used`}
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full transition-[width] motion-reduce:transition-none" style={{ width: `${ratio * 100}%`, background: color }} />
        </div>
      )}
    </div>
  )
}
