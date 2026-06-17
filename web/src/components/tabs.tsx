import { useState } from 'react'
import type { WebSnapshot } from '@shared'
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

export function OverviewTab({ derived, periodLabel }: { derived: Derived; periodLabel: string }) {
  return (
    <div className="flex flex-col gap-4">
      <KpiStrip derived={derived} periodLabel={periodLabel} />
      <CostTimeline derived={derived} periodLabel={periodLabel} heightClass="h-[clamp(320px,42vh,560px)]" />
      <ProviderCards accounts={derived.filteredAccounts} />
    </div>
  )
}

export function AnalyticsTab({ derived }: { derived: Derived }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><CalendarHeatmap derived={derived} /></div>
      <CostByModel derived={derived} />
      <ProviderDonut derived={derived} />
      <TokenComposition derived={derived} />
      <CacheSavings derived={derived} />
      <div className="lg:col-span-2"><CumulativeSpend derived={derived} height={300} /></div>
    </div>
  )
}

export function ModelsTab({ derived }: { derived: Derived }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2"><ModelLeaderboard derived={derived} /></div>
      <CostByModel derived={derived} metric="tokens" limit={12} />
      <ProviderDonut derived={derived} />
      <div className="md:col-span-2"><CacheByModel derived={derived} /></div>
    </div>
  )
}

export function ExploreTab({ snapshot, filters, setFilters }: {
  snapshot: WebSnapshot | null
  filters: Filters
  setFilters: (next: Filters | ((p: Filters) => Filters)) => void
}) {
  const [q, setQ] = useState('')
  const rows = exploreRows(snapshot, filters)
  return (
    <div className="flex min-h-[calc(100vh-200px)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-faint">granularity:</span>
          <Segmented
            options={GRAN_OPTIONS}
            value={filters.gran}
            onChange={gran => setFilters(f => ({ ...f, gran }))}
            size="sm"
            btnClassName="px-3 py-1 text-xs capitalize transition"
          />
        </div>
        <span className="hidden text-xs text-fg-faint sm:inline">{rows.length} {rows.length === 1 ? 'row' : 'rows'}</span>
        <div className="ml-auto flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2 py-1 text-xs focus-within:border-line-2">
          <Search className="size-3 text-fg-faint" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setQ('') }}
            placeholder="filter rows…"
            className="w-32 bg-transparent text-fg outline-none placeholder:text-fg-faint"
          />
          {q && <button onClick={() => setQ('')} aria-label="Clear filter"><X className="size-3 text-fg-faint hover:text-fg" /></button>}
        </div>
      </div>
      <ExploreTable rows={rows} granLabel={filters.gran} q={q} />
    </div>
  )
}
