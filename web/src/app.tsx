import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  createHashHistory, createRootRoute, createRoute, createRouter,
  Link, Outlet, RouterProvider, useRouterState,
} from '@tanstack/react-router'
import type { WebSnapshot } from '@shared'

import { FilterBar } from './components/filter-bar'
import { ShareControl } from './components/share-card'
import { Moon, Sun } from './components/icons'
import { AnalyticsTab, ExploreTab, ModelsTab, OverviewTab, TABS, type TabKey } from './components/tabs'
import { deriveAll, hasBillingSignal, PERIODS, type Derived, type Filters } from './lib/derive'
import { fmtAgo } from './lib/format'
import { useFilters } from './lib/useFilters'
import { useSnapshot, type ConnState } from './lib/useSnapshot'

const pathOf = (k: TabKey) => `/${k}`

interface DashCtx {
  snapshot: WebSnapshot
  filters: Filters
  derived: Derived
  periodLabel: string
  scopeLabel?: string
}
const DashboardContext = createContext<DashCtx | null>(null)
const useDashboard = (): DashCtx => {
  const c = useContext(DashboardContext)
  if (!c) throw new Error('useDashboard outside provider')
  return c
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function useTheme(): ['dark' | 'light', () => void] {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('light') ? 'light' : 'dark')
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('tokmon-theme', next) } catch { }
    setTheme(next)
  }
  return [theme, toggle]
}

function ThemeToggle({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      aria-label="Toggle theme"
      className="rounded border border-line bg-bg-1 p-1.5 text-fg-dim transition hover:border-line-2 hover:text-fg max-sm:p-2.5"
    >
      {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  )
}

function ConnDot({ conn, freshAt }: { conn: ConnState; freshAt: number | null }) {
  const now = useNow()
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

function RootLayout() {
  const { snapshot, conn } = useSnapshot()
  const [filters, setFilters] = useFilters()
  const [theme, toggleTheme] = useTheme()

  const derived = useMemo(() => deriveAll(snapshot, filters), [snapshot, filters])
  const periodLabel = PERIODS.find(p => p.key === filters.period)?.label ?? filters.period
  const scopeLabel = filters.period === 'all' ? undefined : periodLabel

  const pathname = useRouterState({ select: s => s.location.pathname })
  const activeKey: TabKey = (TABS.find(t => pathOf(t.key) === pathname)?.key) ?? 'overview'

  // Drop stale provider/account/model ids (e.g. from a shared URL) once the snapshot
  // reveals them — otherwise a vanished id silently empties every panel.
  useEffect(() => {
    if (!snapshot) return
    const provIds = new Set<string>(snapshot.providers.map(p => p.id))
    const acctIds = new Set<string>(snapshot.accounts.map(a => a.id))
    const cleanProv = filters.providers.filter(p => provIds.has(p))
    const cleanAcct = filters.account === 'all' || acctIds.has(filters.account) ? filters.account : 'all'
    const allModels = new Set<string>()
    for (const a of snapshot.accounts) for (const r of a.table?.monthly ?? []) for (const m of r.breakdown) allModels.add(m.name)
    const cleanModels = allModels.size > 0 ? filters.models.filter(m => allModels.has(m)) : filters.models
    if (cleanProv.length !== filters.providers.length || cleanAcct !== filters.account || cleanModels.length !== filters.models.length) {
      setFilters(f => ({ ...f, providers: cleanProv, account: cleanAcct, models: cleanModels }))
    }
  }, [snapshot, filters, setFilters])

  const usageAccts = snapshot?.accounts.filter(a => a.hasUsage) ?? []
  const hasUsage = usageAccts.length > 0
  const hasBilling = (snapshot?.accounts ?? []).some(hasBillingSignal)
  const billingPending = (snapshot?.accounts ?? []).some(a => a.hasBilling && !hasBillingSignal(a))
  const tablesReady = hasUsage && usageAccts.every(a => a.table != null)
  const everReady = useRef(false)
  useEffect(() => { if (tablesReady) everReady.current = true }, [tablesReady])
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => { const id = setTimeout(() => setGraceOver(true), 12_000); return () => clearTimeout(id) }, [])
  const ready = !hasUsage || tablesReady || everReady.current || graceOver

  const ctx = useMemo<DashCtx | null>(
    () => (snapshot ? { snapshot, filters, derived, periodLabel, scopeLabel } : null),
    [snapshot, filters, derived, periodLabel, scopeLabel],
  )

  return (
    <div className="min-h-screen">
      <header className="relative z-30 border-b border-line bg-bg-0/80 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-5 2xl:max-w-[1920px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
            <span className="font-display text-2xl text-fg-bright">TOKMON</span>
            <span className="hidden text-sm text-fg-faint sm:inline">
              ~/usage <span className="text-prompt">$</span>{' '}
              <span className="text-fg-dim">{activeKey}</span>
              <span className="cursor-blink text-accent">▋</span>
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-3">
              <ConnDot conn={conn} freshAt={snapshot?.generatedAt ?? null} />
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              {ready && (hasUsage || hasBilling) && (
                <ShareControl derived={derived} periodLabel={periodLabel} tz={snapshot?.tz ?? ''} version={snapshot?.version ?? ''} />
              )}
            </div>
          </div>

          <nav className="-mb-px flex items-center gap-1 overflow-x-auto">
            {TABS.map(t => (
              <Link
                key={t.key}
                to={pathOf(t.key)}
                className={`relative shrink-0 border-b-2 px-3 py-2 font-display text-xs uppercase tracking-wider transition ${
                  activeKey === t.key ? 'border-accent text-fg-bright' : 'border-transparent text-fg-faint hover:text-fg-dim'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
        <FilterBar snapshot={snapshot} derived={derived} filters={filters} setFilters={setFilters} />
      </header>

      <main className="mx-auto max-w-[1600px] px-5 2xl:max-w-[1920px] py-5">
        {!snapshot ? (
          <Connecting label={conn === 'error' ? 'connection lost — retrying…' : 'reading usage…'} />
        ) : !hasUsage && !hasBilling ? (
          billingPending && !graceOver && conn !== 'error'
            ? <Connecting label="reading billing…" />
            : (
              <div className="rounded-md border border-line bg-bg-1 p-8 text-center text-sm text-fg-dim">
                No providers detected. Open tokmon, enable a provider, then refresh.
              </div>
            )
        ) : !ready || !ctx ? (
          <Connecting label={conn === 'error' ? 'connection lost — retrying…' : 'reading usage history…'} />
        ) : (
          <DashboardContext.Provider value={ctx}>
            <Outlet />
          </DashboardContext.Provider>
        )}
      </main>

      <footer className="mx-auto max-w-[1600px] px-5 2xl:max-w-[1920px] py-6 text-center text-[11px] text-fg-faint">
        tokmon{snapshot?.version ? ` v${snapshot.version}` : ''} · by David Ilie · live LLM usage dashboard
      </footer>
    </div>
  )
}

function OverviewRoute() {
  const { derived, periodLabel, scopeLabel, snapshot } = useDashboard()
  return <div><OverviewTab derived={derived} periodLabel={periodLabel} scopeLabel={scopeLabel} providers={snapshot.providers} /></div>
}
function AnalyticsRoute() {
  const { derived, scopeLabel } = useDashboard()
  return <div><AnalyticsTab derived={derived} scopeLabel={scopeLabel} /></div>
}
function ModelsRoute() {
  const { derived, scopeLabel } = useDashboard()
  return <div><ModelsTab derived={derived} scopeLabel={scopeLabel} /></div>
}
function ExploreRoute() {
  const { snapshot, filters, periodLabel } = useDashboard()
  return <div><ExploreTab snapshot={snapshot} filters={filters} periodLabel={periodLabel} /></div>
}

const rootRoute = createRootRoute({ component: RootLayout })
const tabRoute = (key: TabKey, component: () => JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path: pathOf(key), component })
const routeTree = rootRoute.addChildren([
  // Bare load ("#/") and "#/overview" both render the overview.
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewRoute }),
  tabRoute('overview', OverviewRoute),
  tabRoute('analytics', AnalyticsRoute),
  tabRoute('models', ModelsRoute),
  tabRoute('explore', ExploreRoute),
])
const router = createRouter({ routeTree, history: createHashHistory(), defaultViewTransition: true })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

export function App() {
  return <RouterProvider router={router} />
}
