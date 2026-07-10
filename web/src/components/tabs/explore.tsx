import { useMemo, useState } from 'react'
import type { WebSnapshot } from '@shared'
import { deriveModelSpotlight, exploreRows, selectAccounts, type Filters, type Granularity } from '../../lib/derive'
import { privacyText } from '../privacy-label'
import { useShare } from '../share-provider'
import { ExploreTable } from '../explore'
import { Search, Share, X } from '../icons'
import { Segmented } from '../ui/controls'

const GRANULARITIES: ReadonlyArray<{ value: Granularity; label: string }> = [
  { value: 'daily', label: 'daily' },
  { value: 'weekly', label: 'weekly' },
  { value: 'monthly', label: 'monthly' },
]

export function ExploreTab({ snapshot, filters, periodLabel, privacyMode }: {
  snapshot: WebSnapshot | null
  filters: Filters
  periodLabel: string
  privacyMode: boolean
}) {
  const [query, setQuery] = useState('')
  const [granularity, setGranularity] = useState<Granularity>('daily')
  const openShare = useShare()
  const selectedModel = filters.models.length === 1 ? filters.models[0] : null
  const rows = useMemo(() => exploreRows(snapshot, filters, granularity), [snapshot, filters, granularity])
  const modelShare = useMemo(
    () => selectedModel ? deriveModelSpotlight(snapshot, filters, selectedModel) : null,
    [snapshot, filters, selectedModel],
  )
  const tablesLoading = useMemo(
    () => (snapshot ? selectAccounts(snapshot, filters) : []).some(account => account.tableState !== 'ready'),
    [snapshot, filters],
  )
  const windowNote = granularity === 'daily'
    ? `scoped to ${periodLabel}`
    : `showing up to ${granularity === 'monthly' ? '12 months' : '12 weeks'}`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-faint">granularity:</span>
          <Segmented
            options={[...GRANULARITIES]}
            value={granularity}
            onChange={setGranularity}
            size="sm"
            ariaLabel="Row granularity"
            btnClassName="px-3 py-1 text-xs capitalize transition"
          />
        </div>
        <span className="text-xs text-fg-faint">{windowNote}</span>
        {tablesLoading ? (
          <span className="text-xs text-fg-faint" role="status" aria-live="polite">loading history<span className="cursor-blink text-accent" aria-hidden>▋</span></span>
        ) : null}
        {selectedModel && modelShare ? (
          <button
            type="button"
            onClick={() => openShare({
              kind: 'model',
              model: selectedModel,
              periodLabel,
              tz: snapshot?.tz ?? '',
              version: snapshot?.version ?? '',
              ...modelShare,
              accounts: modelShare.accounts.map(account => ({ ...account, name: privacyText(account.name, privacyMode) })),
            })}
            className="flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2.5 py-1 text-xs text-fg-dim transition hover:border-accent/60 hover:text-accent active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent max-sm:py-2"
            title="Create a shareable model image"
          >
            <Share className="size-3.5" /><span>share model</span>
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2 py-1 text-xs focus-within:border-line-2 focus-within:ring-1 focus-within:ring-accent">
          <Search className="size-3 text-fg-faint" />
          <input
            type="search"
            name="usage-filter"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') setQuery('') }}
            placeholder="filter rows…"
            aria-label="Filter rows by date or model"
            autoComplete="off"
            spellCheck={false}
            className="w-32 bg-transparent text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear row filter" className="rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
              <X className="size-3 text-fg-faint hover:text-fg" />
            </button>
          ) : null}
        </div>
      </div>
      <ExploreTable rows={rows} granLabel={granularity} q={query} />
    </div>
  )
}
