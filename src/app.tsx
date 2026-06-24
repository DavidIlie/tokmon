import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Box, Text, useInput, useStdout, useApp } from 'ink'
import { useMouse } from '@zenobius/ink-mouse'
import { fetchPeak, type PeakStatus } from './peak'
import {
  loadConfig, saveConfigSync,
  generateAccountId, pickAccentColor,
  DEFAULTS, normalizeConfig, sanitizeTyped, getTrackedAccountRows,
  type Config, type Account as StoredAccount, type TrackedAccountRow,
} from './config'
import { reconcileDaemonConfig } from './config-sync'
import { buildAccounts, accountsByProvider } from './accounts'
import { PROVIDERS, PROVIDER_ORDER, detectProviders, type Account, type ProviderId } from './providers'
import type { TableData } from './types'
import { resolveTimezone } from './tz'
import { loadSeedSnapshot } from './client/seed-cache'
import { glyphs } from './glyphs'
import * as fmt from './format'
import type { AccountStats } from './stats'
import type { WebServerController } from './web/server'
import { Spinner, TabBar, PeakBadge, dispatchLinkClicks } from './ui/shared'
import { DashboardView, chooseLayout, TotalsRow } from './ui/dashboard'
import { TableProviderBar, ControlBar, TokenTable, CursorSpendTable } from './ui/table'
import { cursorModelSpend, type CursorModelSpend } from './providers/cursor/composer'
import { Onboarding, type OnboardItem } from './ui/onboarding'
import { LoadingView, accountReady, statsReadyInput, type ReadyInput } from './ui/loading'
import {
  SettingsView, COLOR_PALETTE, FORM_FIELDS, GENERAL_ROWS,
  type AccountForm, type AccountIdentity, type SettingsTab,
} from './ui/settings'
import { deriveSlots, findActiveSlot, computeChrome } from './ui/app-layout.logic'
import { ResizingView } from './ui/resizing'
import { AccountStrip } from './ui/account-strip'
import { Footer } from './ui/footer'
import { TinyFallback } from './ui/tiny-fallback'
import { useDaemon } from './client/use-daemon'
import { toStatsMap, toCursorRows, pickTable } from './client/snapshot-adapter'
import {
  TABS, VIEWS, SORTS, CURSOR_SORTS,
  type Slot,
  acctKey, clampCaret, spliceInsert, applyStartup,
  upsert, fetchScopeTable, sortLabel, sortRows, filterTokenRows, filterCursorRows, sortCursorRows,
} from './app.logic'
import { openUrl, IS_TTY } from './ui/terminal'
import { handleKey } from './ui/keybindings'

export { detectHyperlinks } from './ui/terminal'
const DEBOUNCE_MS = 300
const LOADER_GRACE_MS = 600
const LOADER_MAX_MS = 8000
const LOADER_MIN_VISIBLE_MS = 700

interface TermSize { cols: number; rows: number; resizing: boolean; live: { cols: number; rows: number } }
function useTerminalSize(settleMs = 90): TermSize {
  const { stdout } = useStdout()
  const read = () => ({ cols: stdout?.columns || 80, rows: stdout?.rows || 24 })
  const [size, setSize] = useState(read)
  const [live, setLive] = useState(read)
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    if (!stdout) return
    let t: ReturnType<typeof setTimeout> | undefined
    const now = () => ({ cols: stdout.columns || 80, rows: stdout.rows || 24 })
    const settle = () => { setSize(now()); setResizing(false) }
    const onResize = () => {
      setLive(now())
      setResizing(true)
      if (t) clearTimeout(t)
      t = setTimeout(settle, settleMs)
    }
    stdout.on('resize', onResize)
    return () => { if (t) clearTimeout(t); stdout.off('resize', onResize) }
  }, [stdout, settleMs])
  return { cols: size.cols, rows: size.rows, resizing, live }
}

export function App({ interval: cliInterval, initialConfig, baseUrl = null, wsToken = null, mode = 'degraded' }: {
  interval?: number
  initialConfig?: Config
  baseUrl?: string | null
  wsToken?: string | null
  mode?: 'connected' | 'degraded'
}) {
  const connected = mode === 'connected' && baseUrl !== null && wsToken !== null
  const degraded = !connected
  const daemon = useDaemon(connected ? baseUrl : null, connected ? wsToken : null)

  const [config, setConfig] = useState<Config | null>(() => initialConfig ? applyStartup(initialConfig, cliInterval) : null)
  const [detected, setDetected] = useState<ProviderId[]>([])
  const [statsLocal, setStats] = useState<Map<string, AccountStats>>(new Map())
  const [peakLocal, setPeak] = useState<PeakStatus | null>(null)
  const [tableLocal, setTable] = useState<TableData | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatedLocal, setUpdated] = useState(new Date())
  const [tab, setTab] = useState(0)
  const [view, setView] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [expanded, setExpanded] = useState(-1)
  const [sort, setSort] = useState(1)
  const [tableProvider, setTableProvider] = useState<ProviderId | null>(null)
  const [search, setSearch] = useState('')
  const [searchMode, setSearchMode] = useState(false)
  const [cursorRowsLocal, setCursorRows] = useState<CursorModelSpend[] | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [settingsCursor, setSettingsCursor] = useState(0)
  const [tzEdit, setTzEdit] = useState<string | null>(null)
  const [tzError, setTzError] = useState<string | null>(null)
  const [tzCaret, setTzCaret] = useState(0)
  const [searchCaret, setSearchCaret] = useState(0)
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null)
  const [onboardSel, setOnboardSel] = useState<ProviderId[] | null>(null)
  const [onboardCursor, setOnboardCursor] = useState(0)
  const [dashPage, setDashPage] = useState(0)
  const [debouncePassed, setDebouncePassed] = useState(false)
  const [graceHold, setGraceHold] = useState(false)
  const [loaderShownAt, setLoaderShownAt] = useState<number | null>(null)
  const loaderDone = useRef(false)
  const [loaderDoneState, setLoaderDoneFlag] = useState(false)
  const setLoaderDone = useCallback((v: boolean) => {
    loaderDone.current = v
    setLoaderDoneFlag(v)
  }, [])
  const prevShowPicker = useRef(false)
  const { exit } = useApp()
  const { cols, rows, resizing, live } = useTerminalSize()

  const webRef = useRef<WebServerController | null>(null)
  const webStartingRef = useRef(false)
  useEffect(() => () => { void webRef.current?.stop() }, [])

  const cfg = config ?? DEFAULTS
  const interval = cliInterval ?? cfg.interval * 1000
  const billingMs = cfg.billingInterval * 60_000
  const tz = resolveTimezone(cfg.timezone)
  const configReady = config !== null

  const accounts = useMemo(() => buildAccounts(cfg, detected), [cfg, detected])
  const trackedAccountRows = useMemo(() => getTrackedAccountRows(cfg, detected, accounts), [cfg, detected, accounts])
  const settingsRowCount = settingsTab === 'general'
    ? GENERAL_ROWS
    : settingsTab === 'providers'
      ? PROVIDER_ORDER.length
      : trackedAccountRows.length + 1
  const accountsRef = useRef<Account[]>([])
  accountsRef.current = accounts
  const rowCountRef = useRef(0)
  const tabRef = useRef(0)
  tabRef.current = tab
  const dashPageCountRef = useRef(1)
  const seededRef = useRef(false)
  const pasteBufRef = useRef<string | null>(null)
  const pasteCarryRef = useRef<string>('')
  const pendingLocalConfigRef = useRef<Config | null>(null)
  const insertPasteRef = useRef<(text: string) => void>(() => {})
  const tzValueRef = useRef('')
  const tzCaretRef = useRef(0)
  const searchValueRef = useRef('')
  const searchCaretRef = useRef(0)
  const accountsKey = useMemo(() => accounts.map(acctKey).join('|'), [accounts])

  const snapshot = daemon.snapshot
  const stats = useMemo(
    () => connected ? toStatsMap(snapshot, accounts) : statsLocal,
    [connected, snapshot, accounts, statsLocal],
  )
  const accountIdentities = useMemo(() => {
    const out = new Map<string, AccountIdentity>()
    for (const [id, stat] of stats) {
      const billing = stat.billing
      if (!billing) continue
      out.set(id, {
        email: billing.email ?? null,
        displayName: billing.displayName ?? null,
        plan: billing.plan ?? null,
      })
    }
    return out
  }, [stats])
  const showPeak = accounts.some(a => a.providerId === 'claude')
  const peak = connected ? (showPeak ? (snapshot?.peak ?? null) : null) : peakLocal
  const updated = useMemo(
    () => connected ? new Date(snapshot?.generatedAt ?? Date.now()) : updatedLocal,
    [connected, snapshot, updatedLocal],
  )
  const intervalLabel = connected && snapshot?.intervalMs
    ? Math.round(snapshot.intervalMs / 1000)
    : cfg.interval
  const readyInputFor = useCallback((id: string): ReadyInput | undefined => {
    if (connected) {
      const wa = snapshot?.accounts.find(a => a.id === id)
      if (!wa) return undefined
      return { summaryState: wa.summaryState, billingState: wa.billingState, billing: wa.billing }
    }
    return statsReadyInput(statsLocal.get(id))
  }, [connected, snapshot, statsLocal])

  const slots: Slot[] = useMemo(() => deriveSlots(accounts), [accounts])
  const { activeSlotIdx, focusId } = useMemo(
    () => findActiveSlot(slots, cfg.activeAccountId),
    [slots, cfg.activeAccountId],
  )
  const visibleAccounts = useMemo(
    () => focusId === null ? accounts : accounts.filter(a => a.id === focusId),
    [accounts, focusId],
  )
  const allGroups = useMemo(() => accountsByProvider(accounts), [accounts])
  const groups = useMemo(
    () => focusId === null ? allGroups : accountsByProvider(visibleAccounts),
    [allGroups, visibleAccounts, focusId],
  )
  const tableProvs = useMemo(() => allGroups.map(g => g.provider), [allGroups])

  const TOO_SMALL = cols < 40 || rows < 12

  const allReady = accounts.length > 0 && accounts.every(a => accountReady(readyInputFor(a.id), a.providerId))

  const { gridBudget } = useMemo(() => computeChrome(slots, cols, rows), [slots, cols, rows])
  const dashLayout = useMemo(() => chooseLayout(
    Math.max(56, cols - 4), gridBudget, groups.length,
    focusId !== null || cfg.dashboardLayout === 'single', cols,
  ), [cols, gridBudget, groups.length, focusId, cfg.dashboardLayout])
  const dashPageCount = dashLayout.pageCount
  const dashPaginated = dashPageCount > 1
  dashPageCountRef.current = dashPageCount

  tzValueRef.current = tzEdit ?? ''
  tzCaretRef.current = clampCaret(tzCaret, (tzEdit ?? '').length)
  searchValueRef.current = search
  searchCaretRef.current = clampCaret(searchCaret, search.length)

  const isPrintable = (input: string, key: { ctrl: boolean; meta: boolean }): boolean =>
    !!input && !key.ctrl && !key.meta && !isPasteInput(input)

  const insertText = (text: string): void => {
    if (showSettings && accountForm && (accountForm.field === 'name' || accountForm.field === 'homeDir')) {
      setAccountForm(f => {
        if (!f || (f.field !== 'name' && f.field !== 'homeDir')) return f
        const r = spliceInsert(f[f.field], f.caret, text)
        return { ...f, [f.field]: r.value, caret: r.caret, error: null }
      })
    } else if (showSettings && tzEdit !== null) {
      const r = spliceInsert(tzValueRef.current, tzCaretRef.current, text)
      tzValueRef.current = r.value; tzCaretRef.current = r.caret
      setTzEdit(r.value); setTzCaret(r.caret); setTzError(null)
    } else if (tab === 1 && searchMode) {
      const r = spliceInsert(searchValueRef.current, searchCaretRef.current, text)
      searchValueRef.current = r.value; searchCaretRef.current = r.caret
      setSearch(r.value); setSearchCaret(r.caret)
    }
  }
  insertPasteRef.current = insertText

  const effTableProvider = (tableProvider && tableProvs.includes(tableProvider)) ? tableProvider : (tableProvs[0] ?? null)
  const tableIsCursor = !!effTableProvider && !PROVIDERS[effTableProvider].hasUsage
  const tableAccounts = useMemo(
    () => effTableProvider ? accounts.filter(a => a.providerId === effTableProvider) : [],
    [accounts, effTableProvider],
  )
  const SORTS_FOR = tableIsCursor ? CURSOR_SORTS : SORTS

  const tableAccountIds = useMemo(() => tableAccounts.map(a => a.id), [tableAccounts])
  const table = useMemo(
    () => connected ? pickTable(snapshot, tableAccountIds) : tableLocal,
    [connected, snapshot, tableAccountIds, tableLocal],
  )
  const cursorRows = useMemo(
    () => connected ? toCursorRows(snapshot, tableAccounts[0]?.id) : cursorRowsLocal,
    [connected, snapshot, tableAccounts, cursorRowsLocal],
  )

  const needsOnboarding = configReady && !cfg.onboarded
  const newProviders = configReady && cfg.onboarded
    ? PROVIDER_ORDER.filter(p => !cfg.knownProviders.includes(p) && detected.includes(p))
    : []
  const showPicker = needsOnboarding || newProviders.length > 0
  const minVisibleHold = loaderShownAt !== null && Date.now() - loaderShownAt < LOADER_MIN_VISIBLE_MS
  const showLoader = configReady && !showPicker && !showSettings && !TOO_SMALL
    && accounts.length > 0 && (!allReady || graceHold || minVisibleHold)
    && (debouncePassed || loaderShownAt !== null) && !loaderDoneState
  const pickerProviders = needsOnboarding ? PROVIDER_ORDER : newProviders
  const onboardEnabled = onboardSel ?? detected
  const onboardItems: OnboardItem[] = pickerProviders.map(pid => ({
    id: pid, name: PROVIDERS[pid].name, color: PROVIDERS[pid].color,
    detected: detected.includes(pid), enabled: onboardEnabled.includes(pid),
  }))

  useEffect(() => {
    const wasPicker = prevShowPicker.current
    prevShowPicker.current = showPicker
    if (wasPicker && !showPicker) {
      setLoaderDone(false)
      setDebouncePassed(false)
      setGraceHold(false)
      setLoaderShownAt(null)
    }
  }, [showPicker])

  useEffect(() => {
    if (showLoader && loaderShownAt === null) setLoaderShownAt(Date.now())
  }, [showLoader, loaderShownAt])

  useEffect(() => {
    if (!initialConfig) loadConfig().then(c => setConfig(applyStartup(c, cliInterval)))
    detectProviders().then(setDetected)
  }, [])

  useEffect(() => {
    if (!degraded) return
    if (seededRef.current || !configReady || showPicker || accounts.length === 0) return
    seededRef.current = true
    loadSeedSnapshot().then(snap => {
      setStats(prev => {
        if (prev.size > 0) return prev
        const next = new Map(prev)
        for (const acc of accountsRef.current) {
          const s = snap[acc.id]
          if (s && (s.dashboard || s.billing)) next.set(acc.id, { account: acc, dashboard: s.dashboard ?? null, billing: s.billing ?? null })
        }
        return next
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [degraded, configReady, showPicker, accountsKey])

  useEffect(() => {
    if (!configReady || showPicker || accounts.length === 0) return
    if (allReady || loaderDone.current) return
    const debounce = setTimeout(() => setDebouncePassed(true), DEBOUNCE_MS)
    const deadline = setTimeout(() => { setLoaderDone(true); setDebouncePassed(false) }, LOADER_MAX_MS)
    return () => { clearTimeout(debounce); clearTimeout(deadline) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configReady, showPicker, accountsKey])

  useEffect(() => {
    if (!allReady || loaderDone.current) return
    if (loaderShownAt === null) { setLoaderDone(true); return }
    setGraceHold(true)
    const minRemaining = Math.max(0, LOADER_MIN_VISIBLE_MS - (Date.now() - loaderShownAt))
    const hold = Math.max(LOADER_GRACE_MS, minRemaining)
    const t = setTimeout(() => { setLoaderDone(true); setGraceHold(false) }, hold)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady, loaderShownAt])

  useEffect(() => {
    if (!degraded || !configReady || showPicker) return
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
          } catch {}
        }))
        if (active) { setError(null); setUpdated(new Date()) }
      } finally {
        if (active) timer = setTimeout(load, interval)
      }
    }
    load()
    return () => { active = false; clearTimeout(timer) }
  }, [degraded, interval, tz, configReady, showPicker, accountsKey])

  useEffect(() => {
    if (!degraded || !configReady || showPicker) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
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
  }, [degraded, billingMs, configReady, showPicker, accountsKey])

  const tableKey = useMemo(
    () => `${effTableProvider}|${tableAccounts.map(acctKey).join(',')}|${tz}`,
    [effTableProvider, tableAccounts, tz],
  )
  useEffect(() => {
    setTable(null); setCursorRows(null)
    setCursor(0); setExpanded(-1)
    setSort(tableIsCursor ? 0 : 1)
    setTableLoading(false)
  }, [tableKey])

  useEffect(() => {
    if (!degraded || tab !== 1 || !effTableProvider) return
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
      } catch {}
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
  }, [degraded, tab, tableKey, interval])

  useEffect(() => { setCursor(0); setExpanded(-1) }, [search])

  useEffect(() => { setDashPage(p => Math.min(p, dashPageCount - 1)) }, [dashPageCount])
  useEffect(() => {
    setSettingsCursor(c => Math.max(-1, Math.min(c, settingsRowCount - 1)))
  }, [settingsRowCount])

  const resetView = useCallback(() => { setCursor(0); setExpanded(-1) }, [])
  const clampRow = (n: number) => Math.max(0, Math.min(rowCountRef.current - 1, n))

  const PASTE_START = '\x1b[200~'
  const PASTE_END = '\x1b[201~'
  const PASTE_MAX = 1 << 20
  const handlePasteData = useCallback((chunk: Buffer | string): boolean => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

    if (pasteBufRef.current !== null) {
      const combined = pasteBufRef.current + s
      const end = combined.indexOf(PASTE_END)
      if (end === -1) {
        if (combined.length >= PASTE_MAX) {
          const clean = sanitizeTyped(combined)
          pasteBufRef.current = null
          if (clean) insertPasteRef.current(clean)
          return true
        }
        pasteBufRef.current = combined
        return true
      }
      const clean = sanitizeTyped(combined.slice(0, end))
      pasteBufRef.current = null
      if (clean) insertPasteRef.current(clean)
      return end + PASTE_END.length >= combined.length
    }

    const combined = pasteCarryRef.current + s
    const start = combined.indexOf(PASTE_START)
    if (start === -1) {
      const keep = Math.min(combined.length, PASTE_START.length - 1)
      pasteCarryRef.current = combined.slice(combined.length - keep)
      return false
    }
    pasteCarryRef.current = ''
    const rest = combined.slice(start + PASTE_START.length)
    const end = rest.indexOf(PASTE_END)
    if (end === -1) {
      pasteBufRef.current = rest
      return true
    }
    const clean = sanitizeTyped(rest.slice(0, end))
    if (clean) insertPasteRef.current(clean)
    return true
  }, [])

  const isPasteInput = useCallback((input: string): boolean => {
    if (pasteBufRef.current !== null) return true
    return input.includes('[200~') || input.includes('[201~')
  }, [])

  const mouse = useMouse()
  useEffect(() => {
    if (!IS_TTY) return
    mouse.enable()
    if (process.stdout.isTTY) {
      try { process.stdout.write('\x1b[?1003l\x1b[?1002l\x1b[?1015l') } catch {}
    }
    const onScroll = (_pos: { x: number; y: number }, dir: string | null) => {
      const up = dir === 'scrollup'
      const t = tabRef.current
      if (t === 1) {
        setCursor(c => up ? Math.max(0, c - 3) : clampRow(c + 3))
      } else if (t === 0 && dashPageCountRef.current > 1) {
        setDashPage(p => up ? Math.max(0, p - 1) : Math.min(dashPageCountRef.current - 1, p + 1))
      }
    }
    mouse.events.on('scroll', onScroll)
    const onData = (d: Buffer | string) => { if (!handlePasteData(d)) dispatchLinkClicks(d) }
    process.stdin.on('data', onData)
    return () => { mouse.events.off('scroll', onScroll); process.stdin.off('data', onData) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateConfig = useCallback((fn: (prev: Config) => Config): void => {
    setConfig(prev => {
      const next = normalizeConfig(fn(prev ?? DEFAULTS) as unknown as Record<string, unknown>)
      pendingLocalConfigRef.current = connected ? next : null
      saveConfigSync(next)
      if (connected) {
        void daemon.setConfig(next)
          .then(saved => {
            if (pendingLocalConfigRef.current && reconcileDaemonConfig(next, saved, pendingLocalConfigRef.current).pendingLocalConfig === null) {
              pendingLocalConfigRef.current = null
            }
          })
          .catch(() => {})
      }
      return next
    })
  }, [connected, daemon])

  const daemonConfig = daemon.config
  useEffect(() => {
    if (!connected || !daemonConfig) return
    setConfig(prev => {
      const reconciled = reconcileDaemonConfig(prev, daemonConfig, pendingLocalConfigRef.current)
      pendingLocalConfigRef.current = reconciled.pendingLocalConfig
      return reconciled.config
    })
  }, [connected, daemonConfig])

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
        return {
          ...c,
          disabledProviders: PROVIDER_ORDER.filter(p => !enabled.includes(p)),
          knownProviders: [...PROVIDER_ORDER],
          onboarded: true,
        }
      }
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

  const cycleAccount = useCallback((dir: 1 | -1): void => {
    if (slots.length <= 1) return
    const next = (activeSlotIdx + dir + slots.length) % slots.length
    updateConfig(c => ({ ...c, activeAccountId: slots[next].id }))
    resetView()
  }, [slots, activeSlotIdx, updateConfig, resetView])

  const cycleTableProvider = useCallback((dir: 1 | -1): void => {
    if (tableProvs.length <= 1) return
    const cur = effTableProvider ? tableProvs.indexOf(effTableProvider) : 0
    const nextProv = tableProvs[(cur + dir + tableProvs.length) % tableProvs.length]
    setTableProvider(nextProv)
    const nextIsCursor = !!nextProv && !PROVIDERS[nextProv].hasUsage
    setSort(nextIsCursor ? 0 : 1)
    setCursor(0); setExpanded(-1); setSearch(''); setSearchCaret(0); setSearchMode(false)
  }, [tableProvs, effTableProvider])

  function openAddAccount(defaults?: Pick<TrackedAccountRow, 'providerId' | 'name' | 'homeDir' | 'color'>): void {
    const providerId = defaults?.providerId ?? ((detected[0] ?? 'claude') as ProviderId)
    setAccountForm({
      mode: 'add', field: 'provider', providerId,
      name: defaults?.name ?? '', homeDir: defaults?.homeDir ?? '~', color: defaults?.color ?? pickAccentColor(cfg.accounts),
      caret: defaults?.name?.length ?? 0,
      editingId: null, error: null,
    })
  }
  function openConfigureAccount(row: TrackedAccountRow): void {
    openAddAccount(row)
  }
  function openEditAccount(acc: StoredAccount): void {
    setAccountForm({
      mode: 'edit', field: 'provider', providerId: acc.providerId,
      name: acc.name, homeDir: acc.homeDir, color: acc.color || PROVIDERS[acc.providerId].color,
      caret: acc.name.length,
      editingId: acc.id, error: null,
    })
  }
  function commitAccountForm(): void {
    if (!accountForm) return
    const name = accountForm.name.trim()
    const homeDir = accountForm.homeDir.trim() || '~'
    if (!name) { setAccountForm({ ...accountForm, error: 'Name required', field: 'name', caret: accountForm.name.length }); return }
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
  const cycleFormField = useCallback((dir: 1 | -1): void => {
    setAccountForm(f => {
      if (!f) return f
      const i = FORM_FIELDS.indexOf(f.field)
      const next = FORM_FIELDS[(i + dir + FORM_FIELDS.length) % FORM_FIELDS.length]
      const caret = next === 'name' ? f.name.length : next === 'homeDir' ? f.homeDir.length : f.caret
      return { ...f, field: next, caret }
    })
  }, [])
  const cycleProvider = useCallback((dir: 1 | -1): void => {
    setAccountForm(f => {
      if (!f) return f
      const i = PROVIDER_ORDER.indexOf(f.providerId)
      return { ...f, providerId: PROVIDER_ORDER[(i + dir + PROVIDER_ORDER.length) % PROVIDER_ORDER.length] }
    })
  }, [])
  const cycleColor = useCallback((dir: 1 | -1): void => {
    setAccountForm(f => {
      if (!f) return f
      const i = COLOR_PALETTE.indexOf(f.color as typeof COLOR_PALETTE[number])
      const idx = i < 0 ? 0 : i
      return { ...f, color: COLOR_PALETTE[(idx + dir + COLOR_PALETTE.length) % COLOR_PALETTE.length] }
    })
  }, [])
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
    setSettingsCursor(c => Math.max(0, Math.min(trackedAccountRows.length - 1, c + dir)))
  }

  async function toggleWeb(): Promise<void> {
    if (connected) {
      if (baseUrl) openUrl(baseUrl)
      return
    }
    if (webRef.current) { openUrl(webRef.current.url); return }
    if (webStartingRef.current) return
    webStartingRef.current = true
    try {
      const { startWebServer } = await import('./web/server')
      const ctrl = await startWebServer({ config: cfg, log: false })
      webRef.current = ctrl
      openUrl(ctrl.url)
    } catch {} finally {
      webStartingRef.current = false
    }
  }

  const onTabSelect = useCallback((i: number) => { setTab(i); resetView() }, [resetView])
  const onStripSelect = useCallback((i: number) => {
    updateConfig(c => ({ ...c, activeAccountId: slots[i].id })); resetView()
  }, [slots, updateConfig, resetView])
  const onProviderSelect = useCallback((p: ProviderId) => {
    setTableProvider(p); setCursor(0); setExpanded(-1); setSearch(''); setSearchCaret(0); setSearchMode(false)
  }, [])
  const onRowClickToken = useCallback((idx: number) => {
    if (idx === cursor) setExpanded(e => e === idx ? -1 : idx); else setCursor(idx)
  }, [cursor])
  const onRowClickCursor = useCallback((idx: number) => setCursor(idx), [])

  const tokenRows = useMemo(
    () => tab === 1 && !tableIsCursor
      ? sortRows(filterTokenRows(table ? [table.daily, table.weekly, table.monthly][view] : [], search), sort)
      : [],
    [tab, tableIsCursor, table, view, search, sort],
  )
  const cursorTableRows = useMemo(
    () => tab === 1 && tableIsCursor
      ? sortCursorRows(filterCursorRows(cursorRows ?? [], search), sort)
      : [],
    [tab, tableIsCursor, cursorRows, search, sort],
  )

  useInput((input, key) => handleKey(input, key, {
    showPicker, pickerProviders, onboardCursor, setOnboardCursor, toggleOnboard, confirmOnboarding, exit,
    showSettings, accountForm, setAccountForm, commitAccountForm, cycleFormField, cycleProvider, cycleColor,
    isPrintable, insertText, tzEdit, setTzEdit, setTzError, updateConfig, setTzCaret, tzValueRef, tzCaretRef,
    tab, searchMode, setSearchMode, search, setSearch, setSearchCaret, searchValueRef, searchCaretRef,
    showLoader, configReady, toggleWeb, settingsCursor, settingsTab, setSettingsTab, setShowSettings, cfg, trackedAccountRows, moveAccount,
    setSettingsCursor, toggleProvider, openEditAccount, openConfigureAccount, deleteAccount, openAddAccount, cycleAccount, setTab,
    resetView, slots, dashPaginated, dashPageCount, setDashPage, cycleTableProvider, setExpanded, setSort,
    SORTS_FOR, tableIsCursor, setView, cursor, rowCountRef, rows, setCursor, clampRow,
  }), { isActive: IS_TTY })

  if (error) return <Box padding={1}><Text color="red">{error}</Text></Box>
  if (!config) return <Box padding={1}><Text dimColor>Loading...</Text></Box>

  if (resizing) return <ResizingView cols={live.cols} rows={live.rows} />

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

  if (showLoader) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} height={rows} overflow="hidden">
        <LoadingView groups={allGroups} stats={stats} cols={cols} rows={rows} readyInput={readyInputFor} />
      </Box>
    )
  }

  if (TOO_SMALL && !showSettings) {
    return <TinyFallback groups={groups} stats={stats} rows={rows} cols={cols} />
  }

  rowCountRef.current = tableIsCursor ? cursorTableRows.length : tokenRows.length

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} height={rows} overflow="hidden">
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="greenBright">{glyphs().dotSel} tokmon</Text>
          <Text dimColor>  {glyphs().middot}  every {intervalLabel}s</Text>
        </Box>
        <Box>
          {peak && (<><PeakBadge peak={peak} /><Text dimColor>  {glyphs().middot}  </Text></>)}
          <Text dimColor>{fmt.time(updated, tz)}</Text>
        </Box>
      </Box>

      {degraded && (
        <Text dimColor>{glyphs().warn} degraded {glyphs().middot} background service unavailable, running in-process</Text>
      )}

      {connected && daemon.conn !== 'live' && (
        <Text dimColor>{glyphs().warn} reconnecting {glyphs().middot} showing last known data</Text>
      )}

      {showSettings ? (
        <SettingsView
          config={cfg}
          cursor={settingsCursor}
          activeTab={settingsTab}
          tzEdit={tzEdit}
          tzCaret={tzCaret}
          tzError={tzError}
          resolvedTz={tz}
          accountForm={accountForm}
          activeAccountId={cfg.activeAccountId}
          trackedAccounts={trackedAccountRows}
          accountIdentities={accountIdentities}
        />
      ) : (
        <>
          <Box marginTop={1} marginBottom={1}>
            <TabBar tabs={TABS} active={tab} onSelect={onTabSelect} />
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
                    onSelect={onStripSelect}
                  />
                </Box>
              )}
              <TotalsRow groups={groups} stats={stats} cols={cols} />
            </>
          )}
          {tab === 1 && (
            <>
              {tableProvs.length > 0 && (
                <TableProviderBar providers={tableProvs} active={effTableProvider} onSelect={onProviderSelect} />
              )}
              <Box height={1} />
              <ControlBar views={VIEWS} period={view} sort={sortLabel(SORTS_FOR[sort % SORTS_FOR.length])}
                search={search} searchCaret={searchCaret} searching={searchMode} showPeriod={!tableIsCursor} />
              <Box height={1} />
              {!effTableProvider ? (
                <Text dimColor>No providers enabled {glyphs().emDash} press s to pick providers.</Text>
              ) : tableLoading && !table && !cursorRows ? (
                <Spinner label="Loading history" />
              ) : tableIsCursor ? (
                <CursorSpendTable
                  rows={cursorTableRows} cursor={cursor} maxRows={Math.max(1, rows - 16)}
                  onRowClick={onRowClickCursor}
                />
              ) : (
                <TokenTable
                  rows={tokenRows} cursor={cursor} expanded={expanded}
                  maxRows={Math.max(1, rows - 16)} cols={cols}
                  onRowClick={onRowClickToken}
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
