import type { WebSnapshot } from '@shared'
import { exploreRows, type Derived, type Filters, type Granularity } from '../lib/derive'
import { Segmented } from './ui'
import { KpiStrip, ProviderCards } from './charts/cards'
import { CacheSavings, CostTimeline, CumulativeSpend } from './charts/timeline'
import { CostByModel, ProviderDonut, TokenComposition } from './charts/breakdown'
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

export function OverviewTab({ derived, periodLabel }: { derived: Derived; periodLabel: string }) {
  return (
    <div className="flex flex-col gap-4">
      <KpiStrip derived={derived} periodLabel={periodLabel} />
      <CostTimeline derived={derived} height={300} />
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
      <div className="lg:col-span-2"><CumulativeSpend derived={derived} /></div>
    </div>
  )
}

export function ModelsTab({ derived }: { derived: Derived }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><ModelLeaderboard derived={derived} /></div>
      <CostByModel derived={derived} limit={12} />
      <ProviderDonut derived={derived} />
    </div>
  )
}

export function ExploreTab({ snapshot, filters, setFilters }: {
  snapshot: WebSnapshot | null
  filters: Filters
  setFilters: (next: Filters | ((p: Filters) => Filters)) => void
}) {
  const rows = exploreRows(snapshot, filters)
  const GRANS: { value: Granularity; label: string }[] = [
    { value: 'daily', label: 'daily' },
    { value: 'weekly', label: 'weekly' },
    { value: 'monthly', label: 'monthly' },
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-fg-faint">granularity:</span>
        <Segmented
          options={GRANS}
          value={filters.gran}
          onChange={gran => setFilters(f => ({ ...f, gran }))}
          size="sm"
          btnClassName="px-3 py-1 text-xs capitalize transition"
        />
      </div>
      <ExploreTable rows={rows} granLabel={filters.gran} />
    </div>
  )
}
