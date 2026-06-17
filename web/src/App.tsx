import { useEffect, useMemo, useRef, useState } from 'react'

import { FilterBar } from './components/FilterBar'
import { ShareControl } from './components/ShareCard'
import { Moon, Sun } from './components/icons'
import { AnalyticsTab, ExploreTab, ModelsTab, OverviewTab, TABS, type TabKey } from './components/tabs'
import { deriveAll, PERIODS } from './lib/derive'
import { fmtAgo } from './lib/format'
import { useFilters } from './lib/useFilters'
import { useSnapshot, type ConnState } from './lib/useSnapshot'

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
  return [tab, (t: TabKey) => { window.history.replaceState(null, '', `${location.pathname}${location.search}#${t}`); setTab(t) }]
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Persists only on toggle so a mount effect can never clobber the saved value.
 *  Initial class is set pre-paint in index.html to avoid flash. */
function useTheme(): ['dark' | 'light', () => void] {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('light') ? 'light' : 'dark')
  useEffect(() => {
    // Keep <html> class in sync (idempotent — safe under StrictMode double-invoke).
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('tokmon-theme', next) } catch { /* private browsing */ }
    setTheme(next)
  }
  return [theme, toggle]
}

function ThemeToggle({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      aria-label="Toggle theme"
      className="rounded border border-line bg-bg-1 p-1.5 text-fg-dim transition hover:border-line-2 hover:text-fg max-sm:p-2.5"
    >
      {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  )
}

function ConnDot({ conn, freshAt, now }: { conn: ConnState; freshAt: number | null; now: number }) {
  const color = conn === 'live' ? 'var(--color-positive)' : conn === 'error' ? 'var(--color-warning)' : 'var(--color-cost)'
  const age = freshAt ? fmtAgo(freshAt, now) : null
  const label = conn === 'live' ? (age ?? 'live')
    : conn === 'connecting' ? 'connecting…'
    : conn === 'reconnecting' ? (age ? `reconnecting · ${age}` : 'reconnecting…')
    : (age ? `offline · ${age}` : 'offline')
  return (
    <span className="flex items-center gap-1.5 text-xs" role="status" aria-label={conn === 'live' ? 'live' : conn}>
      <span className="relative flex size-2">
        {conn === 'live' && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
        <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="inline-block truncate text-fg-dim max-sm:max-w-[7rem]" aria-hidden>{label}</span>
    </span>
  )
}

function Connecting({ label }: { label: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-sm text-fg-dim">
      <span className="font-display text-lg text-fg-dim">tokmon<span className="cursor-blink text-accent">▋</span></span>
      <span className="text-fg-faint">{label}</span>
    </div>
  )
}

export function App() {
  const { snapshot, conn } = useSnapshot()
  const [filters, setFilters] = useFilters()
  const [tab, setTab] = useTab()
  const [theme, toggleTheme] = useTheme()
  const now = useNow()

  const derived = useMemo(() => deriveAll(snapshot, filters), [snapshot, filters])
  const periodLabel = PERIODS.find(p => p.key === filters.period)?.label ?? filters.period
  const scopeLabel = filters.period === 'all' ? undefined : periodLabel

  // Drop stale provider/account ids (e.g. from a shared URL) once the snapshot reveals them.
  useEffect(() => {
    if (!snapshot) return
    const provIds = new Set<string>(snapshot.providers.map(p => p.id))
    const acctIds = new Set<string>(snapshot.accounts.map(a => a.id))
    const cleanProv = filters.providers.filter(p => provIds.has(p))
    const cleanAcct = filters.account === 'all' || acctIds.has(filters.account) ? filters.account : 'all'
    if (cleanProv.length !== filters.providers.length || cleanAcct !== filters.account) {
      setFilters(f => ({ ...f, providers: cleanProv, account: cleanAcct }))
    }
  }, [snapshot, filters, setFilters])

  const usageAccts = snapshot?.accounts.filter(a => a.hasUsage) ?? []
  const hasUsage = usageAccts.length > 0
  const hasBilling = (snapshot?.accounts ?? []).some(a => a.hasBilling && (
    a.billing?.metrics?.length || a.billing?.plan || a.billing?.error ||
    a.billing?.activity?.series?.length || a.billing?.modelSpend?.length
  ))
  // "ready" = every usage account's table fetched, so charts don't flash empty.
  // Billing-only setups have no tables to wait on, so they're ready immediately.
  const tablesReady = hasUsage && usageAccts.every(a => a.table != null)
  const everReady = useRef(false)
  useEffect(() => { if (tablesReady) everReady.current = true }, [tablesReady])
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => { const id = setTimeout(() => setGraceOver(true), 12_000); return () => clearTimeout(id) }, [])
  const ready = !hasUsage || tablesReady || everReady.current || graceOver

  return (
    <div className="min-h-screen">
      <header className="relative z-30 border-b border-line bg-bg-0/80 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-5 2xl:max-w-[1920px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
            <span className="font-display text-2xl text-fg-bright">TOKMON</span>
            <span className="hidden text-sm text-fg-faint sm:inline">
              tokmon ~/usage <span className="text-prompt">$</span>{' '}
              <span className="text-fg-dim">{tab}</span>
              <span className="cursor-blink text-accent">▋</span>
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-3">
              <ConnDot conn={conn} freshAt={snapshot?.generatedAt ?? null} now={now} />
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              <ShareControl derived={derived} periodLabel={periodLabel} tz={snapshot?.tz ?? ''} version={snapshot?.version ?? ''} />
            </div>
          </div>

          <nav className="-mb-px flex items-center gap-1 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative shrink-0 border-b-2 px-3 py-2 font-display text-xs uppercase tracking-wider transition ${
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

      <main className="mx-auto max-w-[1600px] px-5 2xl:max-w-[1920px] py-5">
        {!snapshot ? (
          <Connecting label={conn === 'error' ? 'connection lost — retrying…' : 'reading usage…'} />
        ) : !hasUsage && !hasBilling ? (
          <div className="rounded-md border border-line bg-bg-1 p-8 text-center text-sm text-fg-dim">
            No providers detected. Open tokmon, enable a provider, then refresh.
          </div>
        ) : !ready ? (
          <Connecting label={conn === 'error' ? 'connection lost — retrying…' : 'reading usage history…'} />
        ) : (
          <div key={tab} className="rise">
            {tab === 'overview' && <OverviewTab derived={derived} periodLabel={periodLabel} scopeLabel={scopeLabel} providers={snapshot.providers} />}
            {tab === 'analytics' && <AnalyticsTab derived={derived} scopeLabel={scopeLabel} />}
            {tab === 'models' && <ModelsTab derived={derived} scopeLabel={scopeLabel} />}
            {tab === 'explore' && <ExploreTab snapshot={snapshot} filters={filters} />}
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-[1600px] px-5 2xl:max-w-[1920px] py-6 text-center text-[11px] text-fg-faint">
        tokmon{snapshot?.version ? ` v${snapshot.version}` : ''} · by David Ilie · live LLM usage dashboard
      </footer>
    </div>
  )
}
