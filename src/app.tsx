import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Box, Text, Transform, useInput, useStdout, useApp } from 'ink'
import { useMouse } from '@zenobius/ink-mouse'
import { fetchPeak, type PeakStatus } from './peak'
import {
  loadConfig, saveConfig,
  generateAccountId, pickAccentColor,
  type Config, type Account as StoredAccount,
} from './config'
import { buildAccounts, accountsByProvider } from './accounts'
import { PROVIDERS, PROVIDER_ORDER, detectProviders, type Account, type ProviderId } from './providers'
import { mergeTables } from './providers/usage-core'
import type { TableData, TableRow } from './types'
import { resolveTimezone, isValidTimezone, systemTimezone } from './tz'
import { loadSnapshot, saveSnapshot } from './snapshot'
import { glyphs } from './glyphs'
import * as fmt from './format'
import type { AccountStats } from './stats'
import { ClickableBox, LinkBox, Spinner, TabBar, PeakBadge, truncateName, dispatchLinkClicks } from './ui/shared'
import { DashboardView, chooseLayout, TotalsRow } from './ui/dashboard'
import { TableProviderBar, ControlBar, TokenTable, CursorSpendTable } from './ui/table'
import { cursorModelSpend, type CursorModelSpend } from './providers/cursor/composer'
import { Onboarding, type OnboardItem } from './ui/onboarding'
import { LoadingView, accountReady } from './ui/loading'
import {
  SettingsView, PROVIDER_ROWS_START, ACCOUNT_ROWS_START, COLOR_PALETTE, FORM_FIELDS,
  type AccountForm,
} from './ui/settings'

const TABS = ['Dashboard', 'Table'] as const
const VIEWS = ['Daily', 'Weekly', 'Monthly'] as const
// Bare labels + direction; the ↑/↓ glyph is appended at render time (glyphs() is
// resolved at startup AFTER this module loads, so it can't live in a const here).
const SORTS = [
  { label: 'date', dir: 'up' as const },
  { label: 'date', dir: 'down' as const },
  { label: 'cost', dir: 'up' as const },
  { label: 'cost', dir: 'down' as const },
] as const
const CURSOR_SORTS = [
  { label: 'cost', dir: 'down' as const },
  { label: 'amount', dir: 'down' as const },
  { label: 'model', dir: null },
] as const
const IS_TTY = process.stdin.isTTY === true
const REPO_URL = 'https://github.com/DavidIlie/tokmon'
const SITE_URL = 'https://davidilie.com'
// macOS Terminal.app withholds plain mouse-button clicks from the app (it
// consumes them for text selection) and only forwards SGR button events while
// ⌥ Option is held. It also has no OSC 8 hyperlink support. So in Terminal.app
// the only mouse route to the footer links is ⌥-click — surface that as a hint
// so the underline cue (which implies a plain click) isn't misleading there.
const IS_APPLE_TERMINAL = process.env.TERM_PROGRAM === 'Apple_Terminal'

// Conservative OSC 8 hyperlink support detection (mirrors sindresorhus/
// supports-hyperlinks): emit links only where we're confident the terminal
// renders them, so unsupported terminals never print raw escapes. Computed once.
export function detectHyperlinks(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  const force = env.FORCE_HYPERLINK
  if (force != null && force !== '') return force !== '0' && force.toLowerCase() !== 'false'
  if (!isTTY || env.TERM === 'dumb' || env.NO_HYPERLINK) return false
  if (env.WT_SESSION || env.ConEmuANSI === 'ON' || env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return true
  if (env.KONSOLE_VERSION || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') return true
  if (env.VTE_VERSION && Number(env.VTE_VERSION) >= 5000) return true   // GNOME Terminal / Tilix
  const tp = env.TERM_PROGRAM
  if (tp) {
    const [maj, min] = (env.TERM_PROGRAM_VERSION ?? '').split('.').map(n => Number(n) || 0)
    if (tp === 'iTerm.app') return maj > 3 || (maj === 3 && min >= 1)
    if (tp === 'vscode' || tp === 'WezTerm' || tp === 'ghostty' || tp === 'Hyper' || tp === 'Tabby' || tp === 'rio') return true
  }
  return false
}
const HYPERLINKS = detectHyperlinks(process.env, process.stdout.isTTY === true)

// Open a URL in the default browser. Used by the footer's mouse-click links so
// they work in ANY mouse-reporting terminal (incl. macOS Terminal.app, which
// doesn't support OSC 8 hyperlinks). Best-effort, detached, never throws.
function openUrl(url: string): void {
  // Test hook: when TOKMON_OPENLOG is set, append the URL to that file instead
  // of (well, in addition to) spawning a browser. Lets a PTY harness assert the
  // open-URL path actually fired without launching a real browser. No-op in
  // normal use (the env var is never set), so it can't affect users.
  if (process.env.TOKMON_OPENLOG) {
    try { appendFileSync(process.env.TOKMON_OPENLOG, url + '\n') } catch {}
    return
  }
  try {
    if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
  } catch { /* no browser opener available */ }
}

// OSC 8 terminal hyperlink — clickable in modern terminals (iTerm, Terminal.app,
// VS Code, Windows Terminal, …); terminals without support ignore the escape and
// render the plain text. Only emitted to a real TTY. string-width strips it, so
// it doesn't affect Ink's layout width.
function osc8(text: string, url: string): string {
  if (!HYPERLINKS) return text
  return `]8;;${url}${text}]8;;`
}

// Startup loader timing. DEBOUNCE_MS: how long the gap must last before the
// loader appears (so fast/seeded launches paint straight to the dashboard with
// no flash). LOADER_GRACE_MS: keep the loader up briefly after everything is
// ready so the final ✓ is seen. LOADER_MAX_MS: hard deadline — drop to the
// dashboard regardless, so a hung fetch never strands the user on the loader.
const DEBOUNCE_MS = 300
const LOADER_GRACE_MS = 600
const LOADER_MAX_MS = 8000
// Once the loader is actually on-screen, keep it up at least this long so a
// near-instant "ready" doesn't reduce it to a one-frame flash. Only applies
// after it has shown — instant/seeded launches still skip it entirely.
const LOADER_MIN_VISIBLE_MS = 700

const DEFAULT_CONFIG: Config = {
  interval: 2, billingInterval: 5, clearScreen: true, timezone: null,
  accounts: [], activeAccountId: null, disabledProviders: [], onboarded: false,
  dashboardLayout: 'grid', defaultFocus: 'all', ascii: 'auto', knownProviders: [],
}

type Slot = { id: string | null; name: string; color: string }

// Apply the startup overrides (CLI interval; "all" default focus) to a freshly
// loaded config. Shared by the initial state and the (fallback) load effect.
function applyStartup(c: Config, cliInterval?: number): Config {
  if (cliInterval) c = { ...c, interval: cliInterval / 1000 }
  if (c.defaultFocus === 'all') c = { ...c, activeAccountId: null }
  return c
}

export function App({ interval: cliInterval, initialConfig }: { interval?: number; initialConfig?: Config }) {
  // cli.tsx already loaded the config — seed it synchronously so there's no
  // blank "Loading…" frame and the polls start on the very first render.
  const [config, setConfig] = useState<Config | null>(() => initialConfig ? applyStartup(initialConfig, cliInterval) : null)
  const [detected, setDetected] = useState<ProviderId[]>([])
  const [stats, setStats] = useState<Map<string, AccountStats>>(new Map())
  const [peak, setPeak] = useState<PeakStatus | null>(null)
  const [table, setTable] = useState<TableData | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(new Date())
  const [tab, setTab] = useState(0)
  const [view, setView] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [expanded, setExpanded] = useState(-1)
  const [sort, setSort] = useState(1)
  const [tableProvider, setTableProvider] = useState<ProviderId | null>(null)
  const [search, setSearch] = useState('')
  const [searchMode, setSearchMode] = useState(false)
  const [cursorRows, setCursorRows] = useState<CursorModelSpend[] | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsCursor, setSettingsCursor] = useState(0)
  const [tzEdit, setTzEdit] = useState<string | null>(null)
  const [tzError, setTzError] = useState<string | null>(null)
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null)
  const [onboardSel, setOnboardSel] = useState<ProviderId[] | null>(null)
  const [onboardCursor, setOnboardCursor] = useState(0)
  const [dashPage, setDashPage] = useState(0)
  const [debouncePassed, setDebouncePassed] = useState(false)
  const [graceHold, setGraceHold] = useState(false)   // keep the final ✓ visible briefly
  const [loaderShownAt, setLoaderShownAt] = useState<number | null>(null)   // when the loader first painted (for the min-visible floor)
  const loaderDone = useRef(false)   // one-shot latch: loader shows at most once per process
  const prevShowPicker = useRef(false)   // detect the picker close edge to re-arm the loader
  const { stdout } = useStdout()
  const { exit } = useApp()
  const rows = stdout?.rows ?? 24
  const cols = stdout?.columns ?? 80

  const cfg = config ?? DEFAULT_CONFIG
  const interval = cliInterval ?? cfg.interval * 1000
  const billingMs = cfg.billingInterval * 60_000
  const tz = resolveTimezone(cfg.timezone)
  const configReady = config !== null

  const accounts = useMemo(() => buildAccounts(cfg, detected), [cfg, detected])
  const accountsRef = useRef<Account[]>([])
  accountsRef.current = accounts
  const rowCountRef = useRef(0)   // live table row count, read by the cursor clamp
  const dashPageCountRef = useRef(1)   // live dashboard page count, read by the scroll handler
  const seededRef = useRef(false)      // guards the one-time snapshot seed
  const accountsKey = accounts.map(a => `${a.id}:${a.homeDir ?? ''}`).join('|')

  // Focus slots: "All" plus every account, when there's more than one to choose.
  const slots: Slot[] = accounts.length > 1
    ? [{ id: null, name: 'All', color: 'whiteBright' }, ...accounts.map(a => ({ id: a.id, name: a.name, color: a.color }))]
    : accounts.map(a => ({ id: a.id, name: a.name, color: a.color }))
  const activeSlotIdx = (() => {
    if (cfg.activeAccountId === null) return 0
    const i = slots.findIndex(s => s.id === cfg.activeAccountId)
    return i < 0 ? 0 : i
  })()
  const focusId = slots[activeSlotIdx]?.id ?? null
  const visibleAccounts = focusId === null ? accounts : accounts.filter(a => a.id === focusId)
  const groups = accountsByProvider(visibleAccounts)

  // --- Responsive dashboard sizing -----------------------------------------
  // Below either floor the full dashboard can't render without wrapping chrome
  // (header/strip), so swap to a guaranteed-fits condensed fallback.
  const TOO_SMALL = cols < 40 || rows < 12

  // --- Startup loader gating ----------------------------------------------
  // The loader fills the gap between "accounts known" and "first useful data for
  // every account arrived", but only once (loaderDone) and only if that gap
  // outlasts DEBOUNCE_MS — so seeded/fast launches never flash it. Uses the full
  // unfiltered account list (not focus-filtered) so every provider is shown and
  // a hidden one still fetching can't let the loader exit early.
  const allGroups = accountsByProvider(accounts)
  const allReady = accounts.length > 0 && accounts.every(a => accountReady(stats.get(a.id), a.providerId))
  // `showLoader` is derived further down, once `showPicker` is known.

  const hasStrip = slots.length > 1
  // Focus strip wraps when the chips overflow one line. Estimate chips/row from
  // the slot labels (clipped to 16) so a 2-line strip is budgeted, not assumed 1.
  const stripChipW = (s: Slot) => 2 /*idx+space*/ + 2 /*dot+space*/ + truncateName(s.name, 16).length + 2 /*marginRight*/
  const stripChars = slots.reduce((sum, s) => sum + stripChipW(s), 0)
  const stripLines = hasStrip ? Math.max(1, Math.ceil(stripChars / Math.max(1, cols - 4 /*paddingX*/ - 7 /*"focus  "*/))) : 0
  // Chrome rows that surround the card grid (see layout notes in MEMORY):
  //   outer paddingY 2 · header up-to-2 · tabbar block 3 · strip (marginTop 1 +
  //   stripLines) · totals row (marginTop 1 + 1) · footer (marginTop 1 + 1).
  //   Header may wrap to 2 lines at narrow widths, so budget 2 conservatively to
  //   keep the footer un-clipped. The totals row is always present in dashboard
  //   mode (regardless of hasStrip), so its 2 rows are unconditional.
  const headerRows = cols < 70 ? 2 : 1
  const CHROME = 2 + headerRows + 3 + (hasStrip ? 1 + stripLines : 0) + 2 + 2
  const gridBudget = Math.max(1, rows - CHROME)
  // Mirror DashboardView's solver so page keys only act when paginating.
  const dashLayout = chooseLayout(
    Math.max(56, cols - 4), gridBudget, groups.length,
    focusId !== null || cfg.dashboardLayout === 'single', cols,
  )
  const dashPageCount = dashLayout.pageCount
  const dashPaginated = dashPageCount > 1
  dashPageCountRef.current = dashPageCount   // read by the (tab-scoped) scroll handler

  // The Table tab is provider-scoped (its own selector), independent of the
  // dashboard focus, across all enabled providers.
  const tableProvs = accountsByProvider(accounts).map(g => g.provider)
  const effTableProvider = (tableProvider && tableProvs.includes(tableProvider)) ? tableProvider : (tableProvs[0] ?? null)
  const tableIsCursor = !!effTableProvider && !PROVIDERS[effTableProvider].hasUsage
  const tableAccounts = effTableProvider ? accounts.filter(a => a.providerId === effTableProvider) : []
  const SORTS_FOR = tableIsCursor ? CURSOR_SORTS : SORTS

  const needsOnboarding = configReady && !cfg.onboarded
  // Providers installed but not yet decided on (added since the user last chose).
  // The same picker offers them on boot so they're opted into once, rather than
  // silently appearing.
  const newProviders = configReady && cfg.onboarded
    ? PROVIDER_ORDER.filter(p => !cfg.knownProviders.includes(p) && detected.includes(p))
    : []
  const showPicker = needsOnboarding || newProviders.length > 0
  // Once shown, the loader survives the moment allReady flips (held by the grace
  // timer) so the final ✓ is seen; `graceHold` keeps `showLoader` true across
  // that beat without depending on `!allReady`. `loaderShownAt` adds a small
  // minimum-visible floor so a near-instant ready isn't a one-frame flash — but
  // only once it has actually painted, so seeded/instant launches still skip it.
  const minVisibleHold = loaderShownAt !== null && Date.now() - loaderShownAt < LOADER_MIN_VISIBLE_MS
  const showLoader = configReady && !showPicker && !showSettings && !TOO_SMALL
    && accounts.length > 0 && (!allReady || graceHold || minVisibleHold)
    && (debouncePassed || loaderShownAt !== null) && !loaderDone.current
  const pickerProviders = needsOnboarding ? PROVIDER_ORDER : newProviders
  const onboardEnabled = onboardSel ?? detected
  const onboardItems: OnboardItem[] = pickerProviders.map(pid => ({
    id: pid, name: PROVIDERS[pid].name, color: PROVIDERS[pid].color,
    detected: detected.includes(pid), enabled: onboardEnabled.includes(pid),
  }))

  // Picker-close edge: the polls are gated on !showPicker, so loading only
  // *starts* once the user dismisses the picker. Reset the loader latches here so
  // the load that follows is visible even though some state may have lingered —
  // this is what makes the loader appear right after onboarding / opt-in.
  useEffect(() => {
    const wasPicker = prevShowPicker.current
    prevShowPicker.current = showPicker
    if (wasPicker && !showPicker) {
      loaderDone.current = false
      setDebouncePassed(false)
      setGraceHold(false)
      setLoaderShownAt(null)
    }
  }, [showPicker])

  // Record when the loader first paints, so the minimum-visible floor has a
  // start time. Cleared on the picker-close edge above so a later picker can
  // re-show it. Never set when the loader is skipped (instant/seeded).
  useEffect(() => {
    if (showLoader && loaderShownAt === null) setLoaderShownAt(Date.now())
  }, [showLoader, loaderShownAt])

  useEffect(() => {
    // Fallback only — App is normally seeded with initialConfig from cli.tsx.
    if (!initialConfig) loadConfig().then(c => setConfig(applyStartup(c, cliInterval)))
    detectProviders().then(setDetected)
  }, [])

  // Seed last-known values from the on-disk snapshot the moment accounts are
  // known, so cards paint instantly while the live polls refresh in the
  // background (incremental rendering — never block the UI on slow providers).
  useEffect(() => {
    if (seededRef.current || !configReady || showPicker || accounts.length === 0) return
    seededRef.current = true
    loadSnapshot().then(snap => {
      setStats(prev => {
        if (prev.size > 0) return prev   // live data already arrived — don't clobber
        const next = new Map(prev)
        for (const acc of accountsRef.current) {
          const s = snap[acc.id]
          if (s && (s.dashboard || s.billing)) next.set(acc.id, { account: acc, dashboard: s.dashboard ?? null, billing: s.billing ?? null })
        }
        return next
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configReady, showPicker, accountsKey])

  // Persist the current display values (debounced) so the next launch is instant.
  useEffect(() => {
    if (stats.size === 0) return
    const t = setTimeout(() => saveSnapshot(stats), 500)
    return () => clearTimeout(t)
  }, [stats])

  // Arm the loader debounce once per account set. Keyed on accountsKey (NOT
  // stats) so a per-provider tick can't re-arm it. If everything is already
  // ready (seeded/fast), the early return fires and debouncePassed stays false.
  useEffect(() => {
    if (!configReady || showPicker || accounts.length === 0) return
    if (allReady || loaderDone.current) return
    const debounce = setTimeout(() => setDebouncePassed(true), DEBOUNCE_MS)
    const deadline = setTimeout(() => { loaderDone.current = true; setDebouncePassed(false) }, LOADER_MAX_MS)
    return () => { clearTimeout(debounce); clearTimeout(deadline) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configReady, showPicker, accountsKey])

  // Latch the loader closed once everything is ready. If the loader was actually
  // on-screen, hold it for the grace beat (so the final ✓ is seen) AND until the
  // minimum-visible floor elapses (so it isn't a flash); otherwise (seeded/fast
  // path, where it never painted) latch immediately so it never re-shows on later
  // poll cycles even if a poll transiently nulls a value.
  useEffect(() => {
    if (!allReady || loaderDone.current) return
    if (loaderShownAt === null) { loaderDone.current = true; return }   // never showed → close now
    setGraceHold(true)
    const minRemaining = Math.max(0, LOADER_MIN_VISIBLE_MS - (Date.now() - loaderShownAt))
    const hold = Math.max(LOADER_GRACE_MS, minRemaining)
    const t = setTimeout(() => { loaderDone.current = true; setGraceHold(false) }, hold)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady])

  // Usage poll (token/cost summaries) for usage-capable accounts.
  // Self-scheduling: the next run waits for the current to finish, so a slow
  // cold parse (large Codex history) never piles up overlapping work.
  useEffect(() => {
    // Gated on !showPicker so loading visibly starts AFTER the user picks — the
    // pre-picker render must not accrue progress that would skip the post-picker
    // loader.
    if (!configReady || showPicker) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        await Promise.all(accountsRef.current.map(async (acc) => {
          const provider = PROVIDERS[acc.providerId]
          if (!provider.hasUsage || !provider.fetchSummary) return
          try {
            const dashboard = await provider.fetchSummary(acc, tz)
            if (active) setStats(prev => upsert(prev, acc, { dashboard }))
          } catch {
            // A single account's usage fetch failing is non-fatal — its card just
            // keeps its last value rather than blanking the whole dashboard.
          }
        }))
        if (active) { setError(null); setUpdated(new Date()) }
      } finally {
        if (active) timer = setTimeout(load, interval)
      }
    }
    load()
    return () => { active = false; clearTimeout(timer) }
  }, [interval, tz, configReady, showPicker, accountsKey])

  // Billing poll (rate limits / spend) + peak clock.
  useEffect(() => {
    if (!configReady || showPicker) return   // same picker gating as the usage poll
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        // Kick off the peak clock concurrently with billing so its timeout
        // doesn't serialize after every billing round.
        const peakP = accountsRef.current.some(a => a.providerId === 'claude')
          ? fetchPeak() : Promise.resolve(null)
        await Promise.all(accountsRef.current.map(async (acc) => {
          const provider = PROVIDERS[acc.providerId]
          if (!provider.hasBilling || !provider.fetchBilling) return
          try {
            const billing = await provider.fetchBilling(acc)
            if (active) setStats(prev => upsert(prev, acc, { billing }))
          } catch {}
        }))
        const p = await peakP
        if (active && p) setPeak(p)
      } finally {
        if (active) timer = setTimeout(load, billingMs)
      }
    }
    load()
    return () => { active = false; clearTimeout(timer) }
  }, [billingMs, configReady, showPicker, accountsKey])

  // Table data for the selected table provider (token table or Cursor spend).
  const tableKey = `${effTableProvider}|${tableAccounts.map(a => `${a.id}:${a.homeDir ?? ''}`).join(',')}|${tz}`
  useEffect(() => {
    setTable(null); setCursorRows(null)
    setCursor(0); setExpanded(-1)
    setSort(tableIsCursor ? 0 : 1)   // cost↓ for Cursor, date↓ for token tables
  }, [tableKey])

  // Single effect loads the table then self-schedules refresh (combining load +
  // poll so the refresh actually starts after the first load completes).
  useEffect(() => {
    if (tab !== 1 || !effTableProvider) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const fetchOnce = async () => {
      try {
        if (tableIsCursor) {
          const s = await cursorModelSpend(tableAccounts[0]?.homeDir)
          if (active) setCursorRows(s?.models ?? [])
        } else {
          const r = await fetchScopeTable(tableAccounts, tz)
          if (active) setTable(r)
        }
      } catch { /* keep last data; try again next tick */ }
    }
    const run = async () => {
      setTableLoading(true)
      await fetchOnce()
      if (!active) return
      setTableLoading(false)
      const loop = async () => { await fetchOnce(); if (active) timer = setTimeout(loop, Math.max(interval, 10000)) }
      timer = setTimeout(loop, Math.max(interval, 10000))
    }
    run()
    return () => { active = false; clearTimeout(timer) }
  }, [tab, tableKey, interval])

  // Keep the row cursor in range when filtering changes the visible row count.
  useEffect(() => { setCursor(0); setExpanded(-1) }, [search])

  // Clamp (don't reset) the dashboard page when the page count shrinks — a
  // one-row resize shouldn't snap the user back to page 1.
  useEffect(() => { setDashPage(p => Math.min(p, dashPageCount - 1)) }, [dashPageCount])

  const resetView = useCallback(() => { setCursor(0); setExpanded(-1) }, [])
  // Keep the row cursor within the current table so G / over-scroll can't strand
  // it past the last row (which would make Enter expand nothing and ↑ look stuck).
  const clampRow = (n: number) => Math.max(0, Math.min(rowCountRef.current - 1, n))

  const mouse = useMouse()
  useEffect(() => {
    if (!IS_TTY) return
    mouse.enable()
    const onScroll = (_pos: { x: number; y: number }, dir: string | null) => {
      const up = dir === 'scrollup'
      if (tab === 1) {
        setCursor(c => up ? Math.max(0, c - 3) : c + 3)
      } else if (tab === 0 && dashPageCountRef.current > 1) {
        // Scroll is the primary way to move between dashboard pages.
        setDashPage(p => up ? Math.max(0, p - 1) : Math.min(dashPageCountRef.current - 1, p + 1))
      }
    }
    mouse.events.on('scroll', onScroll)
    // Single raw stdin tap for footer link clicks. Placed here — alongside
    // mouse.enable() — because that's the one spot a process.stdin 'data'
    // listener reliably receives bytes: Ink v5 drains stdin via 'readable'+read(),
    // so a 'data' listener added later (e.g. inside a deeper component) sees
    // nothing, but one added as the stream goes flowing for mouse reporting does.
    // ink-mouse's own click event can't be used (it drops ⌥-modified clicks, the
    // only kind Terminal.app forwards), so we hand each raw chunk to the LinkBox
    // dispatcher to hit-test the links itself.
    const onData = (d: Buffer | string) => dispatchLinkClicks(d)
    process.stdin.on('data', onData)
    return () => { mouse.events.off('scroll', onScroll); process.stdin.off('data', onData) }
  }, [tab])

  function updateConfig(fn: (prev: Config) => Config): void {
    setConfig(prev => {
      const next = fn(prev ?? DEFAULT_CONFIG)
      saveConfig(next)
      return next
    })
  }

  function toggleOnboard(i: number): void {
    if (i < 0 || i >= pickerProviders.length) return
    const pid = pickerProviders[i]
    setOnboardSel(prev => {
      const base = prev ?? detected
      return base.includes(pid) ? base.filter(p => p !== pid) : [...base, pid]
    })
  }
  function toggleProvider(pid: ProviderId): void {
    updateConfig(c => ({
      ...c,
      // Toggling in settings is also an explicit decision → mark it known.
      knownProviders: c.knownProviders.includes(pid) ? c.knownProviders : [...c.knownProviders, pid],
      disabledProviders: c.disabledProviders.includes(pid)
        ? c.disabledProviders.filter(p => p !== pid)
        : [...c.disabledProviders, pid],
    }))
  }
  function confirmOnboarding(): void {
    const enabled = onboardEnabled
    updateConfig(c => {
      if (!c.onboarded) {
        // First run — decide on every provider shown.
        return {
          ...c,
          disabledProviders: PROVIDER_ORDER.filter(p => !enabled.includes(p)),
          knownProviders: [...PROVIDER_ORDER],
          onboarded: true,
        }
      }
      // Boot opt-in: only the newly-offered providers are affected; unselected
      // ones are disabled, and all offered ones become "known" so we don't ask again.
      const newlyDisabled = pickerProviders.filter(p => !enabled.includes(p))
      return {
        ...c,
        disabledProviders: [...new Set([...c.disabledProviders, ...newlyDisabled])],
        knownProviders: [...new Set([...c.knownProviders, ...pickerProviders])],
      }
    })
    setOnboardSel(null)
    setOnboardCursor(0)
  }

  function cycleAccount(dir: 1 | -1): void {
    if (slots.length <= 1) return
    const next = (activeSlotIdx + dir + slots.length) % slots.length
    updateConfig(c => ({ ...c, activeAccountId: slots[next].id }))
    resetView()
  }

  function cycleTableProvider(dir: 1 | -1): void {
    if (tableProvs.length <= 1) return
    const cur = effTableProvider ? tableProvs.indexOf(effTableProvider) : 0
    setTableProvider(tableProvs[(cur + dir + tableProvs.length) % tableProvs.length])
    setCursor(0); setExpanded(-1); setSearch(''); setSearchMode(false)
  }

  function openAddAccount(): void {
    const providerId = (detected[0] ?? 'claude') as ProviderId
    setAccountForm({
      mode: 'add', field: 'provider', providerId,
      name: '', homeDir: '~', color: pickAccentColor(cfg.accounts),
      editingId: null, error: null,
    })
  }
  function openEditAccount(acc: StoredAccount): void {
    setAccountForm({
      mode: 'edit', field: 'provider', providerId: acc.providerId,
      name: acc.name, homeDir: acc.homeDir, color: acc.color || PROVIDERS[acc.providerId].color,
      editingId: acc.id, error: null,
    })
  }
  function commitAccountForm(): void {
    if (!accountForm) return
    const name = accountForm.name.trim()
    const homeDir = accountForm.homeDir.trim() || '~'
    if (!name) { setAccountForm({ ...accountForm, error: 'Name required', field: 'name' }); return }
    updateConfig(c => {
      if (accountForm.mode === 'add') {
        const id = generateAccountId(name, c.accounts)
        const account: StoredAccount = { id, providerId: accountForm.providerId, name, homeDir, color: accountForm.color }
        return { ...c, accounts: [...c.accounts, account] }
      }
      return {
        ...c,
        accounts: c.accounts.map(a =>
          a.id === accountForm.editingId
            ? { ...a, providerId: accountForm.providerId, name, homeDir, color: accountForm.color }
            : a),
      }
    })
    setAccountForm(null)
  }
  function cycleFormField(dir: 1 | -1): void {
    setAccountForm(f => {
      if (!f) return f
      const i = FORM_FIELDS.indexOf(f.field)
      return { ...f, field: FORM_FIELDS[(i + dir + FORM_FIELDS.length) % FORM_FIELDS.length] }
    })
  }
  function cycleProvider(dir: 1 | -1): void {
    setAccountForm(f => {
      if (!f) return f
      const i = PROVIDER_ORDER.indexOf(f.providerId)
      return { ...f, providerId: PROVIDER_ORDER[(i + dir + PROVIDER_ORDER.length) % PROVIDER_ORDER.length] }
    })
  }
  function cycleColor(dir: 1 | -1): void {
    setAccountForm(f => {
      if (!f) return f
      const i = COLOR_PALETTE.indexOf(f.color as typeof COLOR_PALETTE[number])
      const idx = i < 0 ? 0 : i
      return { ...f, color: COLOR_PALETTE[(idx + dir + COLOR_PALETTE.length) % COLOR_PALETTE.length] }
    })
  }
  function deleteAccount(id: string): void {
    updateConfig(c => ({
      ...c,
      accounts: c.accounts.filter(a => a.id !== id),
      activeAccountId: c.activeAccountId === id ? null : c.activeAccountId,
    }))
  }
  function moveAccount(idx: number, dir: -1 | 1): void {
    updateConfig(c => {
      const next = [...c.accounts]
      const target = idx + dir
      if (target < 0 || target >= next.length) return c
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return { ...c, accounts: next }
    })
    setSettingsCursor(c => Math.max(ACCOUNT_ROWS_START, Math.min(ACCOUNT_ROWS_START + cfg.accounts.length - 1, c + dir)))
  }

  const totalSettingsRows = ACCOUNT_ROWS_START + cfg.accounts.length + 1

  useInput((input, key) => {
    if (showPicker) {
      if (input === 'q') { exit(); return }
      const startIdx = pickerProviders.length
      if (key.upArrow) { setOnboardCursor(c => Math.max(0, c - 1)); return }
      if (key.downArrow) { setOnboardCursor(c => Math.min(startIdx, c + 1)); return }
      if (input === ' ') { toggleOnboard(onboardCursor); return }
      if (key.return) {
        if (onboardCursor === startIdx) confirmOnboarding()
        else toggleOnboard(onboardCursor)
        return
      }
      return
    }

    if (showSettings && accountForm) {
      if (key.escape) { setAccountForm(null); return }
      if (key.tab) { cycleFormField(key.shift ? -1 : 1); return }
      if (key.upArrow) { cycleFormField(-1); return }
      if (key.downArrow) { cycleFormField(1); return }
      if (accountForm.field === 'provider') {
        if (key.leftArrow) { cycleProvider(-1); return }
        if (key.rightArrow) { cycleProvider(1); return }
        if (key.return) { setAccountForm(f => f && { ...f, field: 'name' }); return }
        return
      }
      if (accountForm.field === 'color') {
        if (key.leftArrow) { cycleColor(-1); return }
        if (key.rightArrow) { cycleColor(1); return }
        if (key.return) { commitAccountForm(); return }
        return
      }
      if (key.return) {
        setAccountForm(f => f && { ...f, field: f.field === 'name' ? 'homeDir' : 'color' })
        return
      }
      if (key.backspace || key.delete) {
        setAccountForm(f => {
          if (!f || (f.field !== 'name' && f.field !== 'homeDir')) return f
          return { ...f, [f.field]: f[f.field].slice(0, -1), error: null }
        })
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setAccountForm(f => {
          if (!f || (f.field !== 'name' && f.field !== 'homeDir')) return f
          return { ...f, [f.field]: f[f.field] + input, error: null }
        })
      }
      return
    }

    if (showSettings && tzEdit !== null) {
      if (key.escape) { setTzEdit(null); setTzError(null); return }
      if (key.return) {
        const val = tzEdit.trim()
        if (val === '' || val.toLowerCase() === 'system') {
          updateConfig(c => ({ ...c, timezone: null })); setTzEdit(null); setTzError(null)
        } else if (isValidTimezone(val)) {
          updateConfig(c => ({ ...c, timezone: val })); setTzEdit(null); setTzError(null)
        } else {
          setTzError(`Invalid: ${val}`)
        }
        return
      }
      if (key.backspace || key.delete) { setTzEdit(s => (s ?? '').slice(0, -1)); setTzError(null); return }
      if (input && !key.ctrl && !key.meta) { setTzEdit(s => (s ?? '') + input); setTzError(null) }
      return
    }

    // Table search box captures typing before global keybindings (so "q" types).
    if (tab === 1 && searchMode) {
      if (key.return || key.escape) { setSearchMode(false); if (key.escape) setSearch(''); return }
      if (key.backspace || key.delete) { setSearch(s => s.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) { setSearch(s => s + input) }
      return
    }

    if (input === 'q') { exit(); return }
    // Universal "open the repo" shortcut — works in EVERY terminal (incl. macOS
    // Terminal.app, where neither plain mouse-clicks nor OSC 8 hyperlinks reach
    // the footer link). Capital O so it never collides with the Table tab's
    // lowercase o=sort. Placed after the input-capturing modals (picker/forms/
    // search) so it can't swallow a typed 'O'.
    if (input === 'O') { openUrl(REPO_URL); return }

    if (showSettings) {
      if (key.escape || input === 's') { setShowSettings(false); return }
      const accIdxNav = settingsCursor - ACCOUNT_ROWS_START
      const onAccountRow = accIdxNav >= 0 && accIdxNav < cfg.accounts.length
      if (onAccountRow && key.shift && (key.upArrow || key.downArrow)) {
        moveAccount(accIdxNav, key.upArrow ? -1 : 1); return
      }
      if (key.upArrow) { setSettingsCursor(c => Math.max(0, c - 1)); return }
      if (key.downArrow) { setSettingsCursor(c => Math.min(totalSettingsRows - 1, c + 1)); return }

      if (settingsCursor === 0) {
        if (key.leftArrow) updateConfig(c => ({ ...c, interval: Math.max(1, c.interval - 1) }))
        if (key.rightArrow) updateConfig(c => ({ ...c, interval: c.interval + 1 }))
        return
      }
      if (settingsCursor === 1) {
        if (key.leftArrow) updateConfig(c => ({ ...c, billingInterval: Math.max(1, c.billingInterval - 1) }))
        if (key.rightArrow) updateConfig(c => ({ ...c, billingInterval: c.billingInterval + 1 }))
        return
      }
      if (settingsCursor === 2 && (key.leftArrow || key.rightArrow || key.return)) {
        updateConfig(c => ({ ...c, clearScreen: !c.clearScreen })); return
      }
      if (settingsCursor === 3) {
        if (key.return) { setTzEdit(cfg.timezone ?? ''); setTzError(null) }
        if (key.leftArrow || key.rightArrow) updateConfig(c => ({ ...c, timezone: c.timezone === null ? systemTimezone() : null }))
        return
      }
      if (settingsCursor === 4 && (key.leftArrow || key.rightArrow || key.return)) {
        updateConfig(c => ({ ...c, dashboardLayout: c.dashboardLayout === 'grid' ? 'single' : 'grid' }))
        return
      }
      if (settingsCursor === 5 && (key.leftArrow || key.rightArrow || key.return)) {
        updateConfig(c => ({ ...c, defaultFocus: c.defaultFocus === 'all' ? 'last' : 'all' }))
        return
      }

      const provIdx = settingsCursor - PROVIDER_ROWS_START
      if (provIdx >= 0 && provIdx < PROVIDER_ORDER.length) {
        if (input === ' ' || key.return || key.leftArrow || key.rightArrow) toggleProvider(PROVIDER_ORDER[provIdx])
        return
      }

      const accIdx = settingsCursor - ACCOUNT_ROWS_START
      if (accIdx >= 0 && accIdx < cfg.accounts.length) {
        const acc = cfg.accounts[accIdx]
        if (key.return) { openEditAccount(acc); return }
        if (input === 'd' || input === 'x') { deleteAccount(acc.id); return }
        if (input === ' ') { updateConfig(c => ({ ...c, activeAccountId: acc.id })); return }
        return
      }
      if (accIdx === cfg.accounts.length && key.return) { openAddAccount() }
      return
    }

    if (input === 's') { setShowSettings(true); setSettingsCursor(0); return }
    if (input === 'a') { cycleAccount(1); return }
    if (input === 'A') { cycleAccount(-1); return }
    if (key.tab) { setTab(t => (t + 1) % TABS.length); resetView(); return }
    if (input && /^[0-9]$/.test(input) && slots.length > 1) {
      const target = slots[parseInt(input, 10)]
      if (target) { updateConfig(c => ({ ...c, activeAccountId: target.id })); resetView() }
      return
    }
    // Dedicated dashboard paging keys (kept separate from a/A focus-cycle so the
    // user never loses focus control when the grid happens to paginate).
    // Dashboard paging: scroll is the default, but arrows / PgUp-PgDn / [ ] also
    // move between pages (clamped at the ends, matching scroll).
    if (tab === 0 && dashPaginated) {
      if (input === ']' || key.downArrow || key.pageDown) { setDashPage(p => Math.min(dashPageCount - 1, p + 1)); return }
      if (input === '[' || key.upArrow || key.pageUp) { setDashPage(p => Math.max(0, p - 1)); return }
    }

    if (tab === 1) {
      if (input === 'p') { cycleTableProvider(1); return }
      if (input === 'P') { cycleTableProvider(-1); return }
      if (input === '/') { setSearchMode(true); return }
      if (key.escape) { if (search) setSearch(''); else setExpanded(-1); return }
      if (input === 'o') { setSort(s => (s + 1) % SORTS_FOR.length); resetView(); return }
      if (!tableIsCursor) {
        if (input === 'd') { setView(0); resetView(); return }
        if (input === 'w') { setView(1); resetView(); return }
        if (input === 'm') { setView(2); resetView(); return }
        if (key.leftArrow) { setView(v => (v - 1 + VIEWS.length) % VIEWS.length); resetView(); return }
        if (key.rightArrow) { setView(v => (v + 1) % VIEWS.length); resetView(); return }
        if (key.return) { setExpanded(e => e === cursor ? -1 : cursor); return }
      }
    } else {
      if (key.leftArrow || key.rightArrow) { setTab(t => (t + 1) % TABS.length); resetView(); return }
    }

    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => clampRow(c + 1)); return }
    if (key.pageDown || input === 'G') { setCursor(c => clampRow(input === 'G' ? rowCountRef.current - 1 : c + Math.max(1, rows - 12))); return }
    if (key.pageUp || input === 'g') { setCursor(c => input === 'g' ? 0 : Math.max(0, c - Math.max(1, rows - 12))); return }
  }, { isActive: IS_TTY })

  if (error) return <Box padding={1}><Text color="red">{error}</Text></Box>
  if (!config) return <Box padding={1}><Text dimColor>Loading...</Text></Box>

  if (showPicker) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} height={rows}>
        <Onboarding
          items={onboardItems} cursor={onboardCursor} onToggle={toggleOnboard} onConfirm={confirmOnboarding}
          heading={needsOnboarding ? 'Welcome to tokmon' : 'New providers detected'}
          subheading={needsOnboarding
            ? 'Pick the tools you want to track. You can change this anytime in settings.'
            : 'tokmon found these installed since you last set up. Pick which to track.'}
        />
      </Box>
    )
  }

  // Startup loader: shown only in the debounced gap before every account's first
  // useful reading lands (never during the picker/settings/tiny terminal). The
  // global useInput above stays mounted, so q quits during the loader. Matches
  // the dashboard's outer frame so cards appear where the loader rows were.
  if (showLoader) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} height={rows} overflow="hidden">
        <LoadingView groups={allGroups} stats={stats} cols={cols} rows={rows} />
      </Box>
    )
  }

  // Too-small terminal: a guaranteed-fits condensed view. Global useInput stays
  // active (q quits, s settings) so we never trap the user on a tiny screen.
  if (TOO_SMALL && !showSettings) {
    return <TinyFallback groups={groups} stats={stats} rows={rows} cols={cols} />
  }

  // Sorting/filtering a few hundred rows each render is cheap; no useMemo (it
  // would sit below the early returns and break rules-of-hooks).
  const tokenRows = sortRows(filterTokenRows(table ? [table.daily, table.weekly, table.monthly][view] : [], search), sort)
  const cursorTableRows = sortCursorRows(filterCursorRows(cursorRows ?? [], search), sort)
  rowCountRef.current = tableIsCursor ? cursorTableRows.length : tokenRows.length

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} height={rows} overflow="hidden">
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="greenBright">{glyphs().dotSel} tokmon</Text>
          <Text dimColor>  {glyphs().middot}  every {cfg.interval}s</Text>
        </Box>
        <Box>
          {peak && (<><PeakBadge peak={peak} /><Text dimColor>  {glyphs().middot}  </Text></>)}
          <Text dimColor>{fmt.time(updated, tz)}</Text>
        </Box>
      </Box>

      {showSettings ? (
        <SettingsView
          config={cfg}
          cursor={settingsCursor}
          tzEdit={tzEdit}
          tzError={tzError}
          resolvedTz={tz}
          accountForm={accountForm}
          activeAccountId={cfg.activeAccountId}
        />
      ) : (
        <>
          <Box marginTop={1} marginBottom={1}>
            <TabBar tabs={TABS} active={tab} onSelect={(i) => { setTab(i); resetView() }} />
            <Text dimColor>  Tab/{glyphs().arrowL}{glyphs().arrowR}</Text>
          </Box>
          {tab === 0 && (
            <>
              <DashboardView groups={groups} stats={stats} cols={cols} budget={gridBudget} focusId={focusId} layout={cfg.dashboardLayout} page={dashPage} />
              {slots.length > 1 && (
                <Box marginTop={1}>
                  <Text dimColor>focus  </Text>
                  <AccountStrip
                    slots={slots}
                    activeIdx={activeSlotIdx}
                    onSelect={(i) => { updateConfig(c => ({ ...c, activeAccountId: slots[i].id })); resetView() }}
                  />
                </Box>
              )}
              <TotalsRow groups={groups} stats={stats} cols={cols} />
            </>
          )}
          {tab === 1 && (
            <>
              {tableProvs.length > 0 && (
                <TableProviderBar providers={tableProvs} active={effTableProvider} onSelect={(p) => {
                  setTableProvider(p); setCursor(0); setExpanded(-1); setSearch(''); setSearchMode(false)
                }} />
              )}
              <Box height={1} />
              <ControlBar views={VIEWS} period={view} sort={sortLabel(SORTS_FOR[sort % SORTS_FOR.length])}
                search={search} searching={searchMode} showPeriod={!tableIsCursor} />
              <Box height={1} />
              {!effTableProvider ? (
                <Text dimColor>No providers enabled {glyphs().emDash} press s to pick providers.</Text>
              ) : tableLoading && !table && !cursorRows ? (
                <Spinner label="Loading history" />
              ) : tableIsCursor ? (
                <CursorSpendTable
                  rows={cursorTableRows} cursor={cursor} maxRows={Math.max(1, rows - 16)}
                  onRowClick={(idx) => setCursor(idx)}
                />
              ) : (
                <TokenTable
                  rows={tokenRows} cursor={cursor} expanded={expanded}
                  maxRows={Math.max(1, rows - 16)} cols={cols}
                  onRowClick={(idx) => { if (idx === cursor) setExpanded(e => e === idx ? -1 : idx); else setCursor(idx) }}
                />
              )}
            </>
          )}
        </>
      )}

      {(tab === 0 || showSettings) && <Footer hasAccounts={slots.length > 1} paginated={tab === 0 && dashPaginated} cols={cols} />}
    </Box>
  )
}

function upsert(prev: Map<string, AccountStats>, account: Account, patch: Partial<AccountStats>): Map<string, AccountStats> {
  const next = new Map(prev)
  const cur = next.get(account.id) ?? { account, dashboard: null, billing: null }
  next.set(account.id, { ...cur, account, ...patch })
  return next
}

async function fetchScopeTable(scope: Account[], tz: string): Promise<TableData> {
  const tables = await Promise.all(scope.map(async (acc) => {
    const provider = PROVIDERS[acc.providerId]
    if (!provider.fetchTable) return null
    try { return await provider.fetchTable(acc, tz) } catch { return null }
  }))
  const valid = tables.filter((t): t is TableData => t !== null)
  if (valid.length === 0) return { daily: [], weekly: [], monthly: [] }
  if (valid.length === 1) return valid[0]
  return mergeTables(valid)
}

// Assemble a sort label with its direction arrow at call time (so the active
// glyph set is used, not the default one captured at module load).
function sortLabel(entry: { label: string; dir: 'up' | 'down' | null }): string {
  if (entry.dir === 'up') return `${entry.label} ${glyphs().arrowU}`
  if (entry.dir === 'down') return `${entry.label} ${glyphs().arrowD}`
  return entry.label
}

function sortRows(rows: TableRow[], sortIdx: number): TableRow[] {
  const sorted = [...rows]
  switch (sortIdx % SORTS.length) {
    case 0: return sorted.sort((a, b) => a.label.localeCompare(b.label))
    case 1: return sorted.sort((a, b) => b.label.localeCompare(a.label))
    case 2: return sorted.sort((a, b) => a.cost - b.cost)
    case 3: return sorted.sort((a, b) => b.cost - a.cost)
    default: return sorted
  }
}

function filterTokenRows(rows: TableRow[], q: string): TableRow[] {
  if (!q) return rows
  const s = q.toLowerCase()
  return rows.filter(r => r.label.toLowerCase().includes(s) || r.models.some(m => m.toLowerCase().includes(s)))
}

function filterCursorRows(rows: CursorModelSpend[], q: string): CursorModelSpend[] {
  if (!q) return rows
  const s = q.toLowerCase()
  return rows.filter(r => r.name.toLowerCase().includes(s))
}

function sortCursorRows(rows: CursorModelSpend[], sortIdx: number): CursorModelSpend[] {
  const out = [...rows]
  switch (sortIdx % CURSOR_SORTS.length) {
    case 1: return out.sort((a, b) => b.requests - a.requests)
    case 2: return out.sort((a, b) => a.name.localeCompare(b.name))
    default: return out.sort((a, b) => b.usd - a.usd)
  }
}

function AccountStrip({ slots, activeIdx, onSelect }: { slots: Slot[]; activeIdx: number; onSelect: (i: number) => void }) {
  return (
    <Box flexWrap="wrap">
      {slots.map((s, i) => {
        const active = i === activeIdx
        const dot = s.id === null ? glyphs().dotAll : glyphs().dot
        const label = truncateName(s.name, 16)
        return (
          <ClickableBox key={s.id ?? '__all__'} onClick={() => onSelect(i)} marginRight={2}>
            <Text dimColor={!active}>{i}</Text>
            <Text>{' '}</Text>
            <Text color={s.color} bold={active} dimColor={!active}>{dot}</Text>
            <Text>{' '}</Text>
            {active ? <Text bold color={s.color}>{label}</Text> : <Text dimColor>{label}</Text>}
          </ClickableBox>
        )
      })}
    </Box>
  )
}

function Footer({ hasAccounts, paginated, cols }: { hasAccounts: boolean; paginated: boolean; cols: number }) {
  // The footer is a single row of Text siblings; if it overflows the inner
  // content width Ink clips it mid-word ("David Ili"), so drop the optional
  // hints from the right when the terminal is too narrow to hold them. The
  // branding + O=repo + s=settings + q=quit essentials always survive. Display
  // widths (the · is 1 col but 3 bytes, so count glyphs, not bytes).
  const inner = cols - 4   // outer paddingX={2} on both sides
  // O=repo is the universal keyboard route to the GitHub repo (mouse-click on
  // the links doesn't reach the app in Terminal.app). It's part of the base.
  const BASE = 'by David Ilie (davidilie.com)  ·  O=repo  s=settings  q=quit'.length  // ~60 cols
  // ⌥ in Unicode mode, 'opt' in ASCII mode — keep the budget in sync with the
  // glyph actually rendered below.
  const optHint = (glyphs().shift === '⇧' ? '⌥' : 'opt') + '-click links  '
  const OPT = IS_APPLE_TERMINAL ? optHint.length : 0
  const JUMP = '0-9=jump  a/A=cycle  '.length
  const PAGE = 'scroll=page  '.length
  // In Terminal.app, the only mouse route is ⌥-click (and OSC 8 ⌘-click is
  // unsupported) — show that hint first when it fits, since the underline alone
  // would suggest a plain click that won't work there.
  const showOpt = IS_APPLE_TERMINAL && inner >= BASE + OPT
  const showJump = hasAccounts && inner >= BASE + (showOpt ? OPT : 0) + JUMP + (paginated ? PAGE : 0)
  const showPage = paginated && inner >= BASE + (showOpt ? OPT : 0) + (showJump ? JUMP : 0) + PAGE
  return (
    <Box marginTop={1} flexWrap="nowrap">
      <Text dimColor>by </Text>
      {/* Clickable via mouse where the terminal forwards clicks (iTerm/VSCode/
          WezTerm/kitty — and Terminal.app only on ⌥-click). underline = visible
          link cue; Transform adds an OSC 8 link on top for native ⌘/Ctrl-click
          where supported (applied after layout so Ink measures only the visible
          text and never truncates it). LinkBox aligns the mouse hit zone with
          the glyphs (fixes ink-mouse's 1-based vs 0-based off-by-one). The O
          keyboard shortcut is the universal fallback that works everywhere. */}
      <LinkBox onClick={() => openUrl(REPO_URL)}>
        <Transform transform={(s) => osc8(s, REPO_URL)}><Text underline>David Ilie</Text></Transform>
      </LinkBox>
      <Text dimColor> (</Text>
      <LinkBox onClick={() => openUrl(SITE_URL)}>
        <Transform transform={(s) => osc8(s, SITE_URL)}><Text color="cyan" underline>davidilie.com</Text></Transform>
      </LinkBox>
      <Text dimColor>)  {glyphs().middot}  O=repo  s=settings  </Text>
      {showOpt && <Text dimColor>{optHint}</Text>}
      {showJump && <Text dimColor>0-9=jump  a/A=cycle  </Text>}
      {showPage && <Text dimColor>scroll=page  </Text>}
      <Text dimColor>q=quit</Text>
    </Box>
  )
}

/**
 * Guaranteed-fits view for terminals below the layout floor (cols<40 or
 * rows<12). One borderless condensed line per provider — no grid, no bars — so
 * it can never overflow and never overlaps the footer. q/s stay live.
 */
function TinyFallback({ groups, stats, rows, cols }: {
  groups: { provider: ProviderId; accounts: Account[] }[]
  stats: Map<string, AccountStats>
  rows: number
  cols: number
}) {
  const maxLines = Math.max(1, rows - 4)  // title + footer + padding headroom
  const visible = groups.slice(0, maxLines)
  const hidden = groups.length - visible.length
  const w = Math.max(8, cols - 2)
  return (
    <Box flexDirection="column" paddingX={1} height={rows} overflow="hidden">
      <Text bold color="greenBright">{glyphs().dotSel} tokmon</Text>
      {groups.length === 0 ? (
        <Text dimColor>No providers {glyphs().emDash} s=settings</Text>
      ) : (
        visible.map(g => <TinyRow key={g.provider} provider={g.provider} accounts={g.accounts} stats={stats} width={w} />)
      )}
      {hidden > 0 && <Text dimColor>+{hidden} more (enlarge terminal)</Text>}
      <Box flexGrow={1} />
      <Text dimColor>s=settings  q=quit</Text>
    </Box>
  )
}

function TinyRow({ provider, accounts, stats, width }: {
  provider: ProviderId
  accounts: Account[]
  stats: Map<string, AccountStats>
  width: number
}) {
  const meta = PROVIDERS[provider]
  const dashboards = accounts.map(a => stats.get(a.id)?.dashboard).filter(Boolean)
  const billings = accounts.map(a => stats.get(a.id)?.billing).filter(Boolean)
  const todayCost = dashboards.reduce((sum, d) => sum + (d?.today.cost ?? 0), 0)
  const pctMetric = billings.flatMap(b => b?.metrics ?? []).find(m => m.format.kind === 'percent')
  const detail = meta.hasUsage
    ? `${fmt.currency(todayCost)} today`
    : (pctMetric ? `${Math.round(pctMetric.used)}%` : 'billing')
  const name = truncateName(meta.name, Math.max(4, width - 18))
  return (
    <Box width={width}>
      <Text color={meta.color}>{glyphs().dot} </Text>
      <Text bold color={meta.color}>{name}</Text>
      <Box flexGrow={1} />
      <Text dimColor>{detail}</Text>
    </Box>
  )
}
