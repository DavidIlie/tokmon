import { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from './lib/useSnapshot'
import { useFilters } from './lib/useFilters'
import { deriveAll, PERIODS } from './lib/derive'
import { fmtAgo } from './lib/format'
import { FilterBar } from './components/FilterBar'
import { ShareControl } from './components/ShareCard'
import { AnalyticsTab, ExploreTab, ModelsTab, OverviewTab, TABS, type TabKey } from './components/tabs'

function useTab(): [TabKey, (t: TabKey) => void] {
  const read = (): TabKey => {
    const h = location.hash.replace('#', '') as TabKey
    return TABS.some(t => t.key === h) ? h : 'overview'
  }
  const [tab, setTab] = useState<TabKey>(read)
  useEffect(() => {
    const onHash = () => setTab(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return [tab, (t: TabKey) => { window.history.replaceState(null, '', `#${t}`); setTab(t) }]
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function App() {
  const { snapshot, conn, receivedAt } = useSnapshot()
  const [filters, setFilters] = useFilters()
  const [tab, setTab] = useTab()
  const now = useNow()

  const derived = useMemo(() => deriveAll(snapshot, filters), [snapshot, filters])
  const periodLabel = PERIODS.find(p => p.key === filters.period)?.label ?? filters.period
  const hasUsage = (snapshot?.accounts.some(a => a.hasUsage)) ?? false

  return (
    <div className="min-h-screen">
      <header className="relative z-30 border-b border-line bg-bg-0/80 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
            <span className="font-display text-2xl text-fg-bright">TOKMON</span>
            <span className="hidden text-sm text-fg-faint sm:inline">
              tokmon ~/usage <span className="text-prompt">$</span>{' '}
              <span className="text-fg-dim">{tab}</span>
              <span className="cursor-blink text-accent">▋</span>
            </span>
            <div className="ml-auto flex items-center gap-4">
              <ConnDot conn={conn} receivedAt={receivedAt} now={now} />
              <ShareControl derived={derived} periodLabel={periodLabel} tz={snapshot?.tz ?? ''} version={snapshot?.version ?? ''} />
            </div>
          </div>

          <nav className="flex items-center gap-1 -mb-px">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative border-b-2 px-3 py-2 font-display text-xs uppercase tracking-wider transition ${
                  tab === t.key ? 'border-accent text-fg-bright' : 'border-transparent text-fg-faint hover:text-fg-dim'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <FilterBar snapshot={snapshot} derived={derived} filters={filters} setFilters={setFilters} />
      </header>

      <main className="mx-auto max-w-[1600px] px-5 py-5">
        {!snapshot ? (
          <Connecting conn={conn} />
        ) : !hasUsage ? (
          <div className="rounded-md border border-line bg-bg-1 p-8 text-center text-sm text-fg-dim">
            No usage-tracking providers detected. Open tokmon and enable a provider, then refresh.
          </div>
        ) : (
          <div key={tab} className="rise">
            {tab === 'overview' && <OverviewTab derived={derived} periodLabel={periodLabel} />}
            {tab === 'analytics' && <AnalyticsTab derived={derived} />}
            {tab === 'models' && <ModelsTab derived={derived} />}
            {tab === 'explore' && <ExploreTab snapshot={snapshot} filters={filters} setFilters={setFilters} />}
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-[1600px] px-5 py-6 text-center text-[11px] text-fg-faint">
        tokmon{snapshot?.version ? ` v${snapshot.version}` : ''} · by David Ilie · live LLM usage dashboard
      </footer>
    </div>
  )
}

function ConnDot({ conn, receivedAt, now }: { conn: string; receivedAt: number | null; now: number }) {
  const color = conn === 'live' ? 'var(--color-positive)' : conn === 'error' ? 'var(--color-warning)' : 'var(--color-cost)'
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="relative flex size-2">
        {conn === 'live' && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
        <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="text-fg-dim">{conn === 'live' && receivedAt ? fmtAgo(receivedAt, now) : conn}</span>
    </span>
  )
}

function Connecting({ conn }: { conn: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-sm text-fg-dim">
      <span className="font-display text-lg text-fg-dim">tokmon<span className="cursor-blink text-accent">▋</span></span>
      <span className="text-fg-faint">{conn === 'error' ? 'connection lost — retrying…' : 'reading usage…'}</span>
    </div>
  )
}
