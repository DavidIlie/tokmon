import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  createHashHistory, createRootRoute, createRoute, createRouter,
  Link, Outlet, RouterProvider, useNavigate, useRouterState,
} from '@tanstack/react-router'
import { accountProviderOrdinals, DEFAULTS, isDarkOnlyThemePreset, type ConfigState, type WebSnapshot } from '@shared'

import { FilterBar } from './components/filter-bar'
import { ShareControl } from './components/share-card'
import { TABS, type TabKey } from './components/tab-definitions'
import {
  Connecting,
  connectionMessage,
  ConnDot,
  focusDashboard,
  PeakStatusBadge,
  RefreshButton,
  SettingsButton,
  ThemeToggle,
  type RefreshPhase,
} from './components/app-chrome'
import { deriveAll, hasBillingSignal, PERIODS, type Derived, type Filters } from './lib/derive'
import { cleanUnavailableFilters } from './lib/filter-cleanup'
import { useFilters } from './lib/useFilters'
import { useSnapshot } from './lib/useSnapshot'
import { configStateFromUpdateFailure, refreshAllData, subscribeConfig, togglePrivacyMode } from './lib/config-client'
import { isRefreshShortcut } from './lib/refresh-shortcut'
import { isPrivacyShortcut } from './lib/privacy-shortcut'
import { useTheme } from './components/theme-provider'
import { themeVisualization } from './lib/theme-visualization'

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
  resetDisplay: 'relative' | 'absolute'
}
const DashboardContext = createContext<DashCtx | null>(null)
const useDashboard = (): DashCtx => {
  const c = useContext(DashboardContext)
  if (!c) throw new Error('useDashboard outside provider')
  return c
}

function RootLayout() {
  const pathname = useRouterState({ select: s => s.location.pathname })
  const navigate = useNavigate()
  const { snapshot, conn } = useSnapshot()
  const [filters, setFilters] = useFilters()
  const theme = useTheme()
  const settingsDeepLink = pathname === '/settings/accounts'
    ? 'accounts' as const
    : pathname === '/settings' ? 'general' as const : null
  const [showSettings, setShowSettings] = useState(() => settingsDeepLink !== null)
  const [privacyMode, setPrivacyMode] = useState(DEFAULTS.privacyMode)
  const [privacyToggleKey, setPrivacyToggleKey] = useState(DEFAULTS.privacyToggleKey)
  const [allowNetworkAccess, setAllowNetworkAccess] = useState(DEFAULTS.allowNetworkAccess)
  const [resetDisplay, setResetDisplay] = useState(DEFAULTS.resetDisplay)
  const [refreshPhase, setRefreshPhase] = useState<RefreshPhase>('idle')
  const refreshInFlight = useRef<Promise<void> | null>(null)
  const privacyInFlight = useRef<Promise<void> | null>(null)
  const configStateRef = useRef<ConfigState | null>(null)
  const pendingPrivacyRef = useRef<boolean | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (settingsDeepLink) setShowSettings(true)
  }, [settingsDeepLink])

  const acceptConfigState = useCallback((state: ConfigState): void => {
    configStateRef.current = state
    setPrivacyMode(pendingPrivacyRef.current ?? state.config.privacyMode)
    setPrivacyToggleKey(state.config.privacyToggleKey)
    setAllowNetworkAccess(state.config.allowNetworkAccess)
    setResetDisplay(state.config.resetDisplay)
  }, [])

  useEffect(() => {
    if (conn !== 'live') return
    return subscribeConfig(acceptConfigState)
  }, [acceptConfigState, conn])

  const requestRefresh = useCallback((): void => {
    if (refreshInFlight.current) return
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    setRefreshPhase('refreshing')
    const refresh = refreshAllData()
      .then(() => setRefreshPhase('success'))
      .catch(() => setRefreshPhase('error'))
      .finally(() => {
        refreshInFlight.current = null
        refreshTimer.current = setTimeout(() => setRefreshPhase('idle'), 3_000)
      })
    refreshInFlight.current = refresh
  }, [])

  const requestPrivacyToggle = useCallback((): void => {
    if (privacyInFlight.current) return
    const current = configStateRef.current
    if (!current) return
    const desired = !current.config.privacyMode
    pendingPrivacyRef.current = desired
    setPrivacyMode(desired)
    const toggle = togglePrivacyMode(current)
      .then(state => {
        pendingPrivacyRef.current = null
        acceptConfigState(state)
      })
      .catch(error => {
        pendingPrivacyRef.current = null
        const conflict = configStateFromUpdateFailure(error)
        acceptConfigState(conflict ?? configStateRef.current ?? current)
      })
      .finally(() => { privacyInFlight.current = null })
    privacyInFlight.current = toggle.then(() => undefined)
  }, [acceptConfigState])

  useEffect(() => {
    if (conn !== 'live' || showSettings) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPrivacyShortcut(event, privacyToggleKey)) {
        event.preventDefault()
        requestPrivacyToggle()
        return
      }
      if (isRefreshShortcut(event)) {
        event.preventDefault()
        requestRefresh()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [conn, privacyToggleKey, requestPrivacyToggle, requestRefresh, showSettings])

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  const baseDerived = useMemo(() => deriveAll(snapshot, filters), [snapshot, filters])
  const derived = useMemo(() => themeVisualization(baseDerived, theme.appearance), [baseDerived, theme.appearance])
  const periodLabel = PERIODS.find(p => p.key === filters.period)?.label ?? filters.period
  const scopeLabel = filters.period === 'all' ? undefined : periodLabel

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
    () => (snapshot ? { snapshot, filters, derived, periodLabel, scopeLabel, privacyMode, resetDisplay } : null),
    [snapshot, filters, derived, periodLabel, scopeLabel, privacyMode, resetDisplay],
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
              {snapshot?.peak && <PeakStatusBadge peak={snapshot.peak} resetDisplay={resetDisplay} tz={snapshot.tz} />}
              <ConnDot conn={conn} freshAt={snapshot?.generatedAt ?? null} />
              {conn === 'live' && <RefreshButton phase={refreshPhase} onRefresh={requestRefresh} />}
              {conn === 'live' && <SettingsButton onOpen={() => setShowSettings(true)} />}
              <ThemeToggle
                mode={theme.appearance.mode}
                resolvedMode={theme.resolved.mode}
                disabled={!theme.ready || isDarkOnlyThemePreset(theme.appearance.preset)}
                onToggle={() => { void theme.toggleMode() }}
              />
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
        {allowNetworkAccess && (
          <div className="mb-4 rounded border border-critical/60 bg-critical/10 px-3 py-2 text-xs text-critical" role="alert">
            Unsafe network access is enabled. This dashboard may be reachable from your LAN after the daemon restarts.
          </div>
        )}
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
          <SettingsSheet
            snapshot={snapshot}
            initialTab={settingsDeepLink ?? 'general'}
            requestedTab={settingsDeepLink}
            onClose={() => {
              setShowSettings(false)
              if (settingsDeepLink) void navigate({ to: '/overview' })
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function OverviewRoute() {
  const { derived, periodLabel, scopeLabel, snapshot, privacyMode, resetDisplay } = useDashboard()
  // Ordinals come from the whole snapshot, so a filtered card cannot renumber itself.
  const ordinals = accountProviderOrdinals(snapshot.accounts)
  return <Suspense fallback={<RouteFallback label="overview" />}><OverviewTab derived={derived} periodLabel={periodLabel} scopeLabel={scopeLabel} providers={snapshot.providers} privacyMode={privacyMode} ordinals={ordinals} resetDisplay={resetDisplay} tz={snapshot.tz} /></Suspense>
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
function SettingsRoute() {
  return null
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
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings/accounts', component: SettingsRoute }),
])
const router = createRouter({ routeTree, history: createHashHistory(), defaultViewTransition: true })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

export function App() {
  return <RouterProvider router={router} />
}
