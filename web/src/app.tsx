import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  createHashHistory, createRootRoute, createRoute, createRouter,
  Link, Outlet, RouterProvider, useRouterState,
} from '@tanstack/react-router'
import { DEFAULTS, type WebSnapshot } from '@shared'

import { FilterBar } from './components/filter-bar'
import { ShareControl } from './components/share-card'
import { Moon, Settings, Sun } from './components/icons'
import { TABS, type TabKey } from './components/tab-definitions'
import { deriveAll, hasBillingSignal, PERIODS, type Derived, type Filters } from './lib/derive'
import { fmtAgo } from './lib/format'
import { cleanUnavailableFilters } from './lib/filter-cleanup'
import { useFilters } from './lib/useFilters'
import { useSnapshot, type ConnState } from './lib/useSnapshot'
import { subscribeConfig } from './lib/config-client'

const loadOverview = () => Promise.all([
    import('./components/tabs/overview'),
    import('./components/charts/timeline'),
  ] as const).then(([module]) => module)
const loadAnalytics = () => Promise.all([
    import('./components/tabs/analytics'),
    import('./components/charts/breakdown'),
    import('./components/charts/timeline'),
  ] as const).then(([module]) => module)
const loadModels = () => Promise.all([
    import('./components/tabs/models'),
    import('./components/charts/breakdown'),
  ] as const).then(([module]) => module)
const loadExplore = () => import('./components/tabs/explore')

const tabLoaders = {
  overview: loadOverview,
  analytics: loadAnalytics,
  models: loadModels,
  explore: loadExplore,
} satisfies Record<TabKey, () => Promise<unknown>>

const OverviewTab = lazy(() => loadOverview().then(module => ({ default: module.OverviewTab })))
const AnalyticsTab = lazy(() => loadAnalytics().then(module => ({ default: module.AnalyticsTab })))
const ModelsTab = lazy(() => loadModels().then(module => ({ default: module.ModelsTab })))
const ExploreTab = lazy(() => loadExplore().then(module => ({ default: module.ExploreTab })))
const SettingsSheet = lazy(() => import('./components/settings-sheet').then(module => ({ default: module.SettingsSheet })))

const preloadTab = (key: TabKey): void => { void tabLoaders[key]() }

const pathOf = (k: TabKey) => `/${k}`

interface DashCtx {
  snapshot: WebSnapshot
  filters: Filters
  derived: Derived
  periodLabel: string
  scopeLabel?: string
  privacyMode: boolean
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
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f4f5f5' : '#0a0a0a')
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
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded border border-line bg-bg-1 p-1.5 text-fg-dim transition hover:border-line-2 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent max-sm:p-2.5"
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
    : conn === 'auth-required' ? 'authorization required'
    : conn === 'unavailable' ? 'daemon unavailable'
    : (age ? `offline · ${age}` : 'offline')
  return (
    <span className="flex items-center gap-1.5 text-xs" role="status" aria-live="polite">
      <span className="relative flex size-2" aria-hidden>
        {conn === 'live' && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
        <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="inline-block truncate text-fg-dim max-sm:max-w-[7rem]">{label}</span>
    </span>
  )
}

function Connecting({ label }: { label: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-sm text-fg-dim" role="status" aria-live="polite">
      <span className="font-display text-lg text-fg-dim" aria-hidden>tokmon<span className="cursor-blink text-accent">▋</span></span>
      <span className="text-fg-faint">{label}</span>
    </div>
  )
}

function connectionMessage(conn: ConnState, fallback: string): string {
  if (conn === 'auth-required') return 'This dashboard link is missing or expired — return to tokmon and press W.'
  if (conn === 'unavailable') return 'The tokmon daemon is unavailable — return to tokmon and press W.'
  if (conn === 'error' || conn === 'reconnecting') return 'Connection lost — return to tokmon and press W for a fresh link.'
  return fallback
}

function focusDashboard(): void {
  const target = document.getElementById('dashboard-content')
  if (!target) return
  target.scrollIntoView({ block: 'start' })
  requestAnimationFrame(() => target.focus({ preventScroll: true }))
}

function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Settings"
      aria-label="Open settings"
      className="rounded border border-line bg-bg-1 p-1.5 text-fg-dim transition hover:border-line-2 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent max-sm:p-2.5"
    >
      <Settings className="size-3.5" />
    </button>
  )
}

function RootLayout() {
  const { snapshot, conn } = useSnapshot()
  const [filters, setFilters] = useFilters()
  const [theme, toggleTheme] = useTheme()
  const [showSettings, setShowSettings] = useState(false)
  const [privacyMode, setPrivacyMode] = useState(DEFAULTS.privacyMode)

  useEffect(() => {
    if (conn !== 'live') return
    return subscribeConfig(state => setPrivacyMode(state.config.privacyMode))
  }, [conn])

  const derived = useMemo(() => deriveAll(snapshot, filters), [snapshot, filters])
  const periodLabel = PERIODS.find(p => p.key === filters.period)?.label ?? filters.period
  const scopeLabel = filters.period === 'all' ? undefined : periodLabel

  const pathname = useRouterState({ select: s => s.location.pathname })
  const activeKey: TabKey = (TABS.find(t => pathOf(t.key) === pathname)?.key) ?? 'overview'

  useEffect(() => {
    if (!snapshot) return
    const provIds = new Set<string>(snapshot.providers.map(p => p.id))
    const acctIds = new Set<string>(snapshot.accounts.map(a => a.id))
    const allModels = new Set<string>()
    for (const a of snapshot.accounts) for (const r of a.table?.monthly ?? []) for (const m of r.breakdown) allModels.add(m.name)
    const cleaned = cleanUnavailableFilters(filters, {
      providers: provIds,
      accounts: acctIds,
      models: allModels,
      modelsReady: allModels.size > 0,
    })
    if (cleaned !== filters) setFilters(cleaned)
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
    () => (snapshot ? { snapshot, filters, derived, periodLabel, scopeLabel, privacyMode } : null),
    [snapshot, filters, derived, periodLabel, scopeLabel, privacyMode],
  )

  return (
    <div className="min-h-screen">
      <button type="button" onClick={focusDashboard} className="fixed left-3 top-3 z-[100] -translate-y-20 rounded bg-bg-2 px-3 py-2 text-sm text-fg-bright shadow-lg transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        Skip to dashboard
      </button>
      <header className="relative z-30 border-b border-line bg-bg-0/80 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-5 2xl:max-w-[1920px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
            <h1 className="font-display text-2xl text-fg-bright">TOKMON</h1>
            <span className="hidden text-sm text-fg-faint sm:inline">
              ~/usage <span className="text-prompt">$</span>{' '}
              <span className="text-fg-dim">{activeKey}</span>
              <span className="cursor-blink text-accent">▋</span>
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-3">
              <ConnDot conn={conn} freshAt={snapshot?.generatedAt ?? null} />
              {conn === 'live' && <SettingsButton onOpen={() => setShowSettings(true)} />}
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              {ready && (hasUsage || hasBilling) && (
                <ShareControl derived={derived} periodLabel={periodLabel} tz={snapshot?.tz ?? ''} version={snapshot?.version ?? ''} />
              )}
            </div>
          </div>

          <nav className="-mb-px flex items-center gap-1 overflow-x-auto" aria-label="Dashboard sections">
            {TABS.map(t => (
              <Link
                key={t.key}
                to={pathOf(t.key)}
                hash={true}
                aria-current={activeKey === t.key ? 'page' : undefined}
                onMouseEnter={() => preloadTab(t.key)}
                onFocus={() => preloadTab(t.key)}
                className={`relative shrink-0 border-b-2 px-3 py-2 font-display text-xs uppercase tracking-wider transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent ${
                  activeKey === t.key ? 'border-accent text-fg-bright' : 'border-transparent text-fg-faint hover:text-fg-dim'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
        <FilterBar snapshot={snapshot} derived={derived} filters={filters} setFilters={setFilters} privacyMode={privacyMode} />
      </header>

      <main id="dashboard-content" tabIndex={-1} className="mx-auto max-w-[1600px] px-5 2xl:max-w-[1920px] py-5 focus:outline-none">
        {snapshot && conn !== 'live' && (
          <div className="mb-4 rounded border border-line bg-bg-1 px-3 py-2 text-xs text-fg-dim" role="status" aria-live="polite">
            {connectionMessage(conn, 'Reconnecting…')}
          </div>
        )}
        {snapshot?.seeded && (
          <div className="mb-4 flex items-center gap-2 rounded border border-line bg-bg-1 px-3 py-1.5 text-xs text-fg-dim" role="status" aria-live="polite">
            <span className="inline-flex size-2 rounded-full" style={{ background: 'var(--color-cost)' }} aria-hidden />
            showing cached data — refreshing…
          </div>
        )}
        {!snapshot ? (
          <Connecting label={connectionMessage(conn, 'reading usage…')} />
        ) : !hasUsage && !hasBilling ? (
          billingPending && !graceOver && conn !== 'error'
            ? <Connecting label="reading billing…" />
            : (
              <div className="rounded-md border border-line bg-bg-1 p-8 text-center text-sm text-fg-dim">
                No providers detected. Open tokmon, enable a provider, then refresh.
              </div>
            )
        ) : !ready || !ctx ? (
          <Connecting label={connectionMessage(conn, 'reading usage history…')} />
        ) : (
          <DashboardContext.Provider value={ctx}>
            <Outlet />
          </DashboardContext.Provider>
        )}
      </main>

      <footer className="mx-auto max-w-[1600px] px-5 2xl:max-w-[1920px] py-6 text-center text-[11px] text-fg-faint">
        tokmon{snapshot?.version ? ` v${snapshot.version}` : ''} · by David Ilie · live LLM usage dashboard
      </footer>

      {showSettings ? (
        <Suspense fallback={<div className="fixed inset-0 z-[60] grid place-items-center bg-bg-0/70 text-sm text-fg-dim" role="status" aria-live="polite">Opening settings…</div>}>
          <SettingsSheet snapshot={snapshot} onClose={() => setShowSettings(false)} />
        </Suspense>
      ) : null}
    </div>
  )
}

function OverviewRoute() {
  const { derived, periodLabel, scopeLabel, snapshot, privacyMode } = useDashboard()
  return <Suspense fallback={<RouteFallback label="overview" />}><OverviewTab derived={derived} periodLabel={periodLabel} scopeLabel={scopeLabel} providers={snapshot.providers} privacyMode={privacyMode} /></Suspense>
}
function AnalyticsRoute() {
  const { derived, scopeLabel } = useDashboard()
  return <Suspense fallback={<RouteFallback label="analytics" />}><AnalyticsTab derived={derived} scopeLabel={scopeLabel} /></Suspense>
}
function ModelsRoute() {
  const { derived, scopeLabel } = useDashboard()
  return <Suspense fallback={<RouteFallback label="models" />}><ModelsTab derived={derived} scopeLabel={scopeLabel} /></Suspense>
}
function ExploreRoute() {
  const { snapshot, filters, periodLabel, privacyMode } = useDashboard()
  return <Suspense fallback={<RouteFallback label="explore" />}><ExploreTab snapshot={snapshot} filters={filters} periodLabel={periodLabel} privacyMode={privacyMode} /></Suspense>
}

function RouteFallback({ label }: { label: string }) {
  return <div className="min-h-[50vh] content-center text-center text-sm text-fg-faint" role="status" aria-live="polite">Loading {label}…</div>
}

const rootRoute = createRootRoute({ component: RootLayout })
const tabRoute = (key: TabKey, component: () => JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path: pathOf(key), component })
const routeTree = rootRoute.addChildren([
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
