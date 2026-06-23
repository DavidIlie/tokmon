import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { Box, Text, Transform, useInput, useStdout, useApp } from 'ink'
import { useMouse } from '@zenobius/ink-mouse'
import { fetchPeak, type PeakStatus } from './peak'
import {
  loadConfig, saveConfigSync,
  generateAccountId, pickAccentColor,
  DEFAULTS, normalizeConfig, sanitizeTyped,
  type Config, type Account as StoredAccount,
} from './config'
import { reconcileDaemonConfig } from './config-sync'
import { buildAccounts, accountsByProvider } from './accounts'
import { PROVIDERS, PROVIDER_ORDER, detectProviders, type Account, type ProviderId } from './providers'
import { coalesceTables } from './providers/usage-core'
import type { TableData, TableRow } from './types'
import { resolveTimezone, isValidTimezone, systemTimezone } from './tz'
import { loadSeedSnapshot } from './client/seed-cache'
import { glyphs } from './glyphs'
import * as fmt from './format'
import type { AccountStats } from './stats'
import type { WebServerController } from './web/server'
import { ClickableBox, LinkBox, Spinner, TabBar, PeakBadge, truncateName, dispatchLinkClicks } from './ui/shared'
import { DashboardView, chooseLayout, TotalsRow } from './ui/dashboard'
import { TableProviderBar, ControlBar, TokenTable, CursorSpendTable } from './ui/table'
import { cursorModelSpend, type CursorModelSpend } from './providers/cursor/composer'
import { Onboarding, type OnboardItem } from './ui/onboarding'
import { LoadingView, accountReady, statsReadyInput, type ReadyInput } from './ui/loading'
import {
  SettingsView, PROVIDER_ROWS_START, ACCOUNT_ROWS_START, COLOR_PALETTE, FORM_FIELDS,
  type AccountForm,
} from './ui/settings'
import { useDaemon } from './client/use-daemon'
import { toStatsMap, toCursorRows, pickTable } from './client/snapshot-adapter'

const TABS = ['Dashboard', 'Table'] as const
const VIEWS = ['Daily', 'Weekly', 'Monthly'] as const
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
const IS_APPLE_TERMINAL = process.env.TERM_PROGRAM === 'Apple_Terminal'

export function detectHyperlinks(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  const force = env.FORCE_HYPERLINK
  if (force != null && force !== '') return force !== '0' && force.toLowerCase() !== 'false'
  if (!isTTY || env.TERM === 'dumb' || env.NO_HYPERLINK) return false
  if (env.WT_SESSION || env.ConEmuANSI === 'ON' || env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return true
  if (env.KONSOLE_VERSION || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') return true
  if (env.VTE_VERSION && Number(env.VTE_VERSION) >= 5000) return true
  const tp = env.TERM_PROGRAM
  if (tp) {
    const [maj, min] = (env.TERM_PROGRAM_VERSION ?? '').split('.').map(n => Number(n) || 0)
    if (tp === 'iTerm.app') return maj > 3 || (maj === 3 && min >= 1)
    if (tp === 'vscode' || tp === 'WezTerm' || tp === 'ghostty' || tp === 'Hyper' || tp === 'Tabby' || tp === 'rio') return true
  }
  return false
}
const HYPERLINKS = detectHyperlinks(process.env, process.stdout.isTTY === true)

function openUrl(url: string): void {
  if (process.env.TOKMON_OPENLOG) {
    try { appendFileSync(process.env.TOKMON_OPENLOG, url + '\n') } catch {}
    return
  }
  try {
    if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
  } catch {}
}

function osc8(text: string, url: string): string {
  if (!HYPERLINKS) return text
  return `]8;;${url}${text}]8;;`
}

const DEBOUNCE_MS = 300
const LOADER_GRACE_MS = 600
const LOADER_MAX_MS = 8000
const LOADER_MIN_VISIBLE_MS = 700

type Slot = { id: string | null; name: string; color: string }

const acctKey = (a: Account): string => `${a.id}:${a.homeDir ?? ''}`

const TEXT_FIELDS = ['name', 'homeDir'] as const

const clampCaret = (caret: number, len: number): number => Math.max(0, Math.min(caret, len))

function spliceInsert(value: string, caret: number, text: string): { value: string; caret: number } {
  const c = clampCaret(caret, value.length)
  return { value: value.slice(0, c) + text + value.slice(c), caret: c + text.length }
}

function spliceBackspace(value: string, caret: number): { value: string; caret: number } {
  const c = clampCaret(caret, value.length)
  if (c === 0) return { value, caret: 0 }
  return { value: value.slice(0, c - 1) + value.slice(c), caret: c - 1 }
}

function applyStartup(c: Config, cliInterval?: number): Config {
  if (cliInterval) c = { ...c, interval: cliInterval / 1000 }
  if (c.defaultFocus === 'all') c = { ...c, activeAccountId: null }
  return c
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

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

function ResizingView({ cols, rows }: { cols: number; rows: number }) {
  return (
    <Box width={cols} height={rows} alignItems="center" justifyContent="center">
      <Text dimColor>{glyphs().dotSel} resizing… <Text color="greenBright">{cols}</Text>×<Text color="greenBright">{rows}</Text></Text>
    </Box>
  )
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

  const slots: Slot[] = useMemo(() => accounts.length > 1
    ? [{ id: null, name: 'All', color: 'whiteBright' }, ...accounts.map(a => ({ id: a.id, name: a.name, color: a.color }))]
    : accounts.map(a => ({ id: a.id, name: a.name, color: a.color })),
    [accounts])
  const activeSlotIdx = useMemo(() => {
    if (cfg.activeAccountId === null) return 0
    const i = slots.findIndex(s => s.id === cfg.activeAccountId)
    return i < 0 ? 0 : i
  }, [slots, cfg.activeAccountId])
  const focusId = useMemo(() => slots[activeSlotIdx]?.id ?? null, [slots, activeSlotIdx])
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

  const hasStrip = slots.length > 1
  const stripChipW = (s: Slot) => 2 + 2 + truncateName(s.name, 16).length + 2
  const stripChars = slots.reduce((sum, s) => sum + stripChipW(s), 0)
  const stripLines = hasStrip ? Math.max(1, Math.ceil(stripChars / Math.max(1, cols - 4 - 7))) : 0
  const headerRows = cols < 70 ? 2 : 1
  const CHROME = 2 + headerRows + 3 + (hasStrip ? 1 + stripLines : 0) + 2 + 2
  const gridBudget = Math.max(1, rows - CHROME)
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
  // Render read uses the state mirror (not the ref) so flipping the latch
  // re-renders and the loader actually disappears (P15).
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

  // True when stdin input should be ignored by Ink's useInput text branches
  // because handlePasteData already owns it: a paste is in flight, or this chunk
  // carries a (possibly ESC-stripped) bracketed-paste marker. Prevents the
  // double-insert / leaked `[200~` that would otherwise land in focused fields.
  const isPasteInput = useCallback((input: string): boolean => {
    if (pasteBufRef.current !== null) return true
    return input.includes('[200~') || input.includes('[201~')
  }, [])

  const mouse = useMouse()
  useEffect(() => {
    if (!IS_TTY) return
    mouse.enable()
    // ink-mouse also enables motion tracking (1003/1002) which floods stdin; drop those, keep click (1000) + SGR (1006).
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

  function openAddAccount(): void {
    const providerId = (detected[0] ?? 'claude') as ProviderId
    setAccountForm({
      mode: 'add', field: 'provider', providerId,
      name: '', homeDir: '~', color: pickAccentColor(cfg.accounts),
      caret: 0,
      editingId: null, error: null,
    })
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
    setSettingsCursor(c => Math.max(ACCOUNT_ROWS_START, Math.min(ACCOUNT_ROWS_START + cfg.accounts.length - 1, c + dir)))
  }

  const totalSettingsRows = ACCOUNT_ROWS_START + cfg.accounts.length + 1

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
      if (key.ctrl && input === 's') { commitAccountForm(); return }
      if (key.tab) { cycleFormField(key.shift ? -1 : 1); return }
      if (key.upArrow) { cycleFormField(-1); return }
      if (key.downArrow) { cycleFormField(1); return }
      if (accountForm.field === 'provider') {
        if (key.leftArrow) { cycleProvider(-1); return }
        if (key.rightArrow) { cycleProvider(1); return }
        if (key.return) { setAccountForm(f => f && { ...f, field: 'name', caret: f.name.length }); return }
        return
      }
      if (accountForm.field === 'color') {
        if (key.leftArrow) { cycleColor(-1); return }
        if (key.rightArrow) { cycleColor(1); return }
        if (key.return) { commitAccountForm(); return }
        return
      }
      const tf = accountForm.field as 'name' | 'homeDir'
      if (key.leftArrow) { setAccountForm(f => f && { ...f, caret: clampCaret(f.caret - 1, f[tf].length) }); return }
      if (key.rightArrow) { setAccountForm(f => f && { ...f, caret: clampCaret(f.caret + 1, f[tf].length) }); return }
      if (key.ctrl && input === 'a') { setAccountForm(f => f && { ...f, caret: 0 }); return }
      if (key.ctrl && input === 'e') { setAccountForm(f => f && { ...f, caret: f[tf].length }); return }
      if (key.return) {
        if (tf === 'name' && accountForm.name.trim() === '') {
          setAccountForm(f => f && { ...f, error: 'Name required', caret: f.name.length })
          return
        }
        setAccountForm(f => f && { ...f, field: tf === 'name' ? 'homeDir' : 'color', caret: tf === 'name' ? f.homeDir.length : f.caret })
        return
      }
      if (key.backspace || key.delete) {
        setAccountForm(f => {
          if (!f || (f.field !== 'name' && f.field !== 'homeDir')) return f
          const r = spliceBackspace(f[f.field], f.caret)
          return { ...f, [f.field]: r.value, caret: r.caret, error: null }
        })
        return
      }
      if (isPrintable(input, key)) {
        const clean = sanitizeTyped(input)
        if (clean) insertText(clean)
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
      if (key.leftArrow) { setTzCaret(c => clampCaret(c - 1, tzEdit.length)); return }
      if (key.rightArrow) { setTzCaret(c => clampCaret(c + 1, tzEdit.length)); return }
      if (key.ctrl && input === 'a') { setTzCaret(0); return }
      if (key.ctrl && input === 'e') { setTzCaret(tzEdit.length); return }
      if (key.backspace || key.delete) {
        const r = spliceBackspace(tzValueRef.current, tzCaretRef.current)
        tzValueRef.current = r.value; tzCaretRef.current = r.caret
        setTzEdit(r.value); setTzCaret(r.caret); setTzError(null)
        return
      }
      if (isPrintable(input, key)) { const clean = sanitizeTyped(input); if (clean) insertText(clean) }
      return
    }

    if (tab === 1 && searchMode) {
      if (key.return || key.escape) { setSearchMode(false); if (key.escape) { setSearch(''); setSearchCaret(0) } return }
      if (key.leftArrow) { setSearchCaret(c => clampCaret(c - 1, search.length)); return }
      if (key.rightArrow) { setSearchCaret(c => clampCaret(c + 1, search.length)); return }
      if (key.ctrl && input === 'a') { setSearchCaret(0); return }
      if (key.ctrl && input === 'e') { setSearchCaret(search.length); return }
      if (key.backspace || key.delete) {
        const r = spliceBackspace(searchValueRef.current, searchCaretRef.current)
        searchValueRef.current = r.value; searchCaretRef.current = r.caret
        setSearch(r.value); setSearchCaret(r.caret)
        return
      }
      if (isPrintable(input, key)) { const clean = sanitizeTyped(input); if (clean) insertText(clean) }
      return
    }

    if (input === 'q') { exit(); return }
    if (input === 'O') { openUrl(REPO_URL); return }
    if (input === 'W' || (input === 'w' && tab !== 1 && !showSettings)) {
      if (showLoader || !configReady) return
      void toggleWeb(); return
    }

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
        if (key.return) { const init = cfg.timezone ?? ''; setTzEdit(init); setTzCaret(init.length); setTzError(null) }
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
    if (tab === 0) {
      if (dashPaginated) {
        if (input === ']' || key.downArrow || key.pageDown) { setDashPage(p => Math.min(dashPageCount - 1, p + 1)); return }
        if (input === '[' || key.upArrow || key.pageUp) { setDashPage(p => Math.max(0, p - 1)); return }
      }
      if (key.upArrow || key.downArrow || key.pageUp || key.pageDown || input === 'G' || input === 'g') return
    }

    if (tab === 1) {
      if (input === 'p') { cycleTableProvider(1); return }
      if (input === 'P') { cycleTableProvider(-1); return }
      if (input === '/') { setSearchMode(true); setSearchCaret(search.length); return }
      if (key.escape) { if (search) { setSearch(''); setSearchCaret(0) } else setExpanded(-1); return }
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

    if (tab === 1 && !tableIsCursor) {
      if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
      if (key.downArrow) { setCursor(c => clampRow(c + 1)); return }
      if (key.pageDown || input === 'G') { setCursor(c => clampRow(input === 'G' ? rowCountRef.current - 1 : c + Math.max(1, rows - 12))); return }
      if (key.pageUp || input === 'g') { setCursor(c => input === 'g' ? 0 : Math.max(0, c - Math.max(1, rows - 12))); return }
    }
  }, { isActive: IS_TTY })

  if (error) return <Box padding={1}><Text color="red">{error}</Text></Box>
  if (!config) return <Box padding={1}><Text dimColor>Loading...</Text></Box>

  // While a drag-resize is in flight, render a minimal overlay sized to the LIVE terminal
  // (the layout below uses the debounced size, which is briefly stale mid-drag).
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
          tzEdit={tzEdit}
          tzCaret={tzCaret}
          tzError={tzError}
          resolvedTz={tz}
          accountForm={accountForm}
          activeAccountId={cfg.activeAccountId}
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
  return coalesceTables(valid)
}

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

const AccountStrip = memo(function AccountStrip({ slots, activeIdx, onSelect }: { slots: Slot[]; activeIdx: number; onSelect: (i: number) => void }) {
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
})

const Footer = memo(function Footer({ hasAccounts, paginated, cols }: { hasAccounts: boolean; paginated: boolean; cols: number }) {
  const inner = cols - 4
  const BASE = 'by David Ilie (davidilie.com)  ·  O=repo  W=web  s=settings  q=quit'.length
  const optHint = (glyphs().shift === '⇧' ? '⌥' : 'opt') + '-click links  '
  const OPT = IS_APPLE_TERMINAL ? optHint.length : 0
  const JUMP = '0-9=jump  a/A=cycle  '.length
  const PAGE = 'scroll=page  '.length
  const showOpt = IS_APPLE_TERMINAL && inner >= BASE + OPT
  const showJump = hasAccounts && inner >= BASE + (showOpt ? OPT : 0) + JUMP + (paginated ? PAGE : 0)
  const showPage = paginated && inner >= BASE + (showOpt ? OPT : 0) + (showJump ? JUMP : 0) + PAGE
  return (
    <Box marginTop={1} flexWrap="nowrap">
      <Text dimColor>by </Text>
      <LinkBox onClick={() => openUrl(REPO_URL)}>
        <Transform transform={(s) => osc8(s, REPO_URL)}><Text underline>David Ilie</Text></Transform>
      </LinkBox>
      <Text dimColor> (</Text>
      <LinkBox onClick={() => openUrl(SITE_URL)}>
        <Transform transform={(s) => osc8(s, SITE_URL)}><Text color="cyan" underline>davidilie.com</Text></Transform>
      </LinkBox>
      <Text dimColor>)  {glyphs().middot}  O=repo  W=web  s=settings  </Text>
      {showOpt && <Text dimColor>{optHint}</Text>}
      {showJump && <Text dimColor>0-9=jump  a/A=cycle  </Text>}
      {showPage && <Text dimColor>scroll=page  </Text>}
      <Text dimColor>q=quit</Text>
    </Box>
  )
})

function TinyFallback({ groups, stats, rows, cols }: {
  groups: { provider: ProviderId; accounts: Account[] }[]
  stats: Map<string, AccountStats>
  rows: number
  cols: number
}) {
  const maxLines = Math.max(1, rows - 4)
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
