import { useState } from 'react'
import type { WebProviderInfo, WebSnapshot } from '@shared'
import { exploreRows, type Derived, type Filters, type Granularity } from '../lib/derive'
import { Segmented } from './ui'
import { Search, X } from './icons'
import { KpiStrip, ProviderCards } from './charts/cards'
import { CacheSavings, CostTimeline, CumulativeSpend } from './charts/timeline'
import { CacheByModel, CostByModel, ProviderDonut, TokenComposition } from './charts/breakdown'
import { CalendarHeatmap } from './charts/calendar'
import { ModelLeaderboard } from './charts/models'
import { ExploreTable } from './Explore'

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
      <CostTimeline derived={derived} periodLabel={scopeLabel} heightClass="h-[clamp(320px,42vh,560px)]" />
      <ProviderCards accounts={derived.cardAccounts} nameOf={nameOf} />
    </div>
  )
}

export function AnalyticsTab({ derived, scopeLabel }: { derived: Derived; scopeLabel?: string }) {
  const multiProvider = derived.byProvider.length > 1
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><CalendarHeatmap derived={derived} /></div>
      <CostByModel derived={derived} periodLabel={scopeLabel} />
      {multiProvider ? <ProviderDonut derived={derived} periodLabel={scopeLabel} /> : <TokenComposition derived={derived} periodLabel={scopeLabel} />}
      {multiProvider && <TokenComposition derived={derived} periodLabel={scopeLabel} />}
      <CacheSavings derived={derived} periodLabel={scopeLabel} />
      <div className="lg:col-span-2"><CumulativeSpend derived={derived} height={300} periodLabel={scopeLabel} /></div>
    </div>
  )
}

export function ModelsTab({ derived, scopeLabel }: { derived: Derived; scopeLabel?: string }) {
  const multiProvider = derived.byProvider.length > 1
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2"><ModelLeaderboard derived={derived} periodLabel={scopeLabel} /></div>
      <div className={multiProvider ? undefined : 'md:col-span-2'}>
        <CostByModel derived={derived} metric="tokens" limit={12} periodLabel={scopeLabel} />
      </div>
      {multiProvider && <ProviderDonut derived={derived} periodLabel={scopeLabel} />}
      <div className="md:col-span-2"><CacheByModel derived={derived} periodLabel={scopeLabel} /></div>
    </div>
  )
}

export function ExploreTab({ snapshot, filters }: {
  snapshot: WebSnapshot | null
  filters: Filters
}) {
  const [q, setQ] = useState('')
  const [gran, setGran] = useState<Granularity>('daily')
  const rows = exploreRows(snapshot, filters, gran)
  return (
    <div className="flex min-h-[calc(100vh-200px)] flex-col gap-3">
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
