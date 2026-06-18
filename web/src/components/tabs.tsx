import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import type { WebProviderInfo, WebSnapshot } from '@shared'
import { exploreRows, type Derived, type Filters, type Granularity } from '../lib/derive'
import { Segmented } from './ui'
import { Search, X } from './icons'
import { KpiStrip, ProviderCards } from './charts/cards'
import { CalendarHeatmap } from './charts/calendar'
import { ModelLeaderboard } from './charts/models'
import { ExploreTable } from './explore'

const timelineMod = () => import('./charts/timeline')
const breakdownMod = () => import('./charts/breakdown')
void timelineMod(); void breakdownMod()

const CostTimeline = lazy(() => timelineMod().then(m => ({ default: m.CostTimeline })))
const CumulativeSpend = lazy(() => timelineMod().then(m => ({ default: m.CumulativeSpend })))
const CacheSavings = lazy(() => timelineMod().then(m => ({ default: m.CacheSavings })))
const CostByModel = lazy(() => breakdownMod().then(m => ({ default: m.CostByModel })))
const ProviderDonut = lazy(() => breakdownMod().then(m => ({ default: m.ProviderDonut })))
const TokenComposition = lazy(() => breakdownMod().then(m => ({ default: m.TokenComposition })))
const CacheByModel = lazy(() => breakdownMod().then(m => ({ default: m.CacheByModel })))

const Spacer = ({ className }: { className?: string }) => <div className={className} aria-hidden />
const Charts = ({ children }: { children: ReactNode }) => <Suspense fallback={null}>{children}</Suspense>

export type TabKey = 'overview' | 'analytics' | 'models' | 'explore'
export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'overview' },
  { key: 'analytics', label: 'analytics' },
  { key: 'models', label: 'models' },
  { key: 'explore', label: 'explore' },
]

const GRAN_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'daily', label: 'daily' },
  { value: 'weekly', label: 'weekly' },
  { value: 'monthly', label: 'monthly' },
]

export function OverviewTab({ derived, periodLabel, scopeLabel, providers }: {
  derived: Derived
  periodLabel: string
  scopeLabel?: string
  providers: WebProviderInfo[]
}) {
  const nameOf = (id: string) => providers.find(p => p.id === id)?.name ?? id
  return (
    <div className="flex flex-col gap-4">
      <KpiStrip derived={derived} periodLabel={periodLabel} />
      <Suspense fallback={<Spacer className="h-[clamp(320px,42vh,560px)]" />}>
        <CostTimeline derived={derived} periodLabel={scopeLabel} heightClass="h-[clamp(320px,42vh,560px)]" />
      </Suspense>
      <ProviderCards accounts={derived.cardAccounts} nameOf={nameOf} />
    </div>
  )
}

export function AnalyticsTab({ derived, scopeLabel }: { derived: Derived; scopeLabel?: string }) {
  const multiProvider = derived.byProvider.length > 1
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2"><CalendarHeatmap derived={derived} periodLabel={scopeLabel} /></div>
      <Charts><CostByModel derived={derived} periodLabel={scopeLabel} /></Charts>
      <Charts>{multiProvider ? <ProviderDonut derived={derived} periodLabel={scopeLabel} /> : <TokenComposition derived={derived} periodLabel={scopeLabel} />}</Charts>
      {multiProvider && <Charts><TokenComposition derived={derived} periodLabel={scopeLabel} /></Charts>}
      <div className={multiProvider ? undefined : 'md:col-span-2'}><Charts><CacheSavings derived={derived} periodLabel={scopeLabel} /></Charts></div>
      <div className="md:col-span-2"><Charts><CumulativeSpend derived={derived} height={300} periodLabel={scopeLabel} /></Charts></div>
    </div>
  )
}

export function ModelsTab({ derived, scopeLabel }: { derived: Derived; scopeLabel?: string }) {
  const multiProvider = derived.byProvider.length > 1
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2"><ModelLeaderboard derived={derived} periodLabel={scopeLabel} /></div>
      <div className={multiProvider ? undefined : 'md:col-span-2'}>
        <Charts><CostByModel derived={derived} metric="tokens" limit={12} periodLabel={scopeLabel} /></Charts>
      </div>
      {multiProvider && <Charts><ProviderDonut derived={derived} periodLabel={scopeLabel} /></Charts>}
      <div className="md:col-span-2"><Charts><CacheByModel derived={derived} periodLabel={scopeLabel} /></Charts></div>
    </div>
  )
}

export function ExploreTab({ snapshot, filters, periodLabel }: {
  snapshot: WebSnapshot | null
  filters: Filters
  periodLabel: string
}) {
  const [q, setQ] = useState('')
  const [gran, setGran] = useState<Granularity>('daily')
  const rows = useMemo(() => exploreRows(snapshot, filters, gran), [snapshot, filters, gran])
  const windowNote = gran !== 'daily'
    ? `showing up to ${gran === 'monthly' ? '12 months' : '12 weeks'}`
    : filters.period !== 'all' ? `scoped to ${periodLabel}` : null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-faint">granularity:</span>
          <Segmented
            options={GRAN_OPTIONS}
            value={gran}
            onChange={setGran}
            size="sm"
            ariaLabel="row granularity"
            btnClassName="px-3 py-1 text-xs capitalize transition"
          />
        </div>
        {windowNote && <span className="text-xs text-fg-faint">{windowNote}</span>}
        <div className="ml-auto flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2 py-1 text-xs focus-within:border-line-2">
          <Search className="size-3 text-fg-faint" />
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setQ('') }}
            placeholder="filter rows…"
            aria-label="Filter rows by date or model"
            autoComplete="off"
            spellCheck={false}
            className="w-32 bg-transparent text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:appearance-none"
          />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Clear filter"><X className="size-3 text-fg-faint hover:text-fg" aria-hidden /></button>}
        </div>
      </div>
      <ExploreTable rows={rows} granLabel={gran} q={q} />
    </div>
  )
}
