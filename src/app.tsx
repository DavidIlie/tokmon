import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { Box, Text, Transform, useInput, useStdout, useApp } from 'ink'
import { useMouse } from '@zenobius/ink-mouse'
import { fetchPeak, type PeakStatus } from './peak'
import {
  loadConfig, saveConfig,
  generateAccountId, pickAccentColor,
  DEFAULTS, sanitizeTyped,
  type Config, type Account as StoredAccount,
} from './config'
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

// Stable per-account serialization used to key effect dep arrays (account
// add/remove/homeDir change). Pure, module-scoped so it carries no closure.
const acctKey = (a: Account): string => `${a.id}:${a.homeDir ?? ''}`

// The only account-form fields that are free-text (carry a caret). provider and
// color are value-cyclers; left/right there cycle the value, not move a caret.
const TEXT_FIELDS = ['name', 'homeDir'] as const

// Clamp a caret position into [0, len].
const clampCaret = (caret: number, len: number): number => Math.max(0, Math.min(caret, len))

// Insert `text` into `value` at `caret`, returning the new value + caret (after
// the inserted run). Pure — shared by every text field's typed-char + paste path.
function spliceInsert(value: string, caret: number, text: string): { value: string; caret: number } {
  const c = clampCaret(caret, value.length)
  return { value: value.slice(0, c) + text + value.slice(c), caret: c + text.length }
}

// Delete one char to the LEFT of `caret` (backspace). No-op at column 0.
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

// Key-order-independent structural compare for the daemon-config echo (P16).
// The daemon normalizes/re-orders keys, so JSON.stringify(a) === JSON.stringify(b)
// is a false negative even when the two configs are semantically identical —
// which forced a redundant setConfig + full re-render (visible focus-chip flash)
// a few hundred ms after every config keypress. This compares values regardless
// of key order so the echo only adopts (and re-renders) on a real change.
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

// Debounced terminal size: report a settled size (so the expensive layout only
// recomputes once a drag-resize stops, not on every SIGWINCH), and expose `resizing`
// so a lightweight overlay can show during the drag instead of a thrashing relayout.
interface TermSize { cols: number; rows: number; resizing: boolean; live: { cols: number; rows: number } }
function useTerminalSize(settleMs = 90): TermSize {
  const { stdout } = useStdout()
  // `|| 80` (not `??`): a non-TTY/piped stdout can report columns/rows of 0 or undefined.
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
  // The daemon base URL (null in DEGRADED mode). When set, the TUI renders from
  // the daemon over WS-RPC; when null it runs the in-process loops below.
  baseUrl?: string | null
  wsToken?: string | null
  mode?: 'connected' | 'degraded'
}) {
  const connected = mode === 'connected' && baseUrl !== null && wsToken !== null
  const degraded = !connected
  // The daemon client. In DEGRADED mode baseUrl is null and the hook stays inert
  // (snapshot null / conn 'connecting'); the in-process effects below take over.
  const daemon = useDaemon(connected ? baseUrl : null, connected ? wsToken : null)

  const [config, setConfig] = useState<Config | null>(() => initialConfig ? applyStartup(initialConfig, cliInterval) : null)
  const [detected, setDetected] = useState<ProviderId[]>([])
  // In-process (DEGRADED) live state. In CONNECTED mode these are unused for
  // rendering — stats/peak/table/cursorRows/updated are derived from the daemon
  // snapshot below — but the hooks stay declared so the in-process effects can
  // keep populating them when degraded.
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
  // Caret columns for the two non-form text inputs (tz editor, table search).
  // The account-form caret lives inside accountForm (per-field). All clamped to
  // their value's length and reset to end when the field (re)opens.
  const [tzCaret, setTzCaret] = useState(0)
  const [searchCaret, setSearchCaret] = useState(0)
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null)
  const [onboardSel, setOnboardSel] = useState<ProviderId[] | null>(null)
  const [onboardCursor, setOnboardCursor] = useState(0)
  const [dashPage, setDashPage] = useState(0)
  const [debouncePassed, setDebouncePassed] = useState(false)
  const [graceHold, setGraceHold] = useState(false)
  const [loaderShownAt, setLoaderShownAt] = useState<number | null>(null)
  // loaderDone gates the loader in two ways: a ref for the LIVE reads inside the
  // gating effects' bodies/timeouts (must reflect the latest write synchronously,
  // even between renders), and a mirrored state so the RENDER read (showLoader)
  // re-renders when the latch flips (P15). Mutating only the ref doesn't schedule
  // a render, so a write with no coincident setState (the allReady + null-shownAt
  // branch) could leave the loader stuck on screen until an unrelated re-render.
  // setLoaderDone() updates both; reads pick ref (live) vs state (render) per site.
  const loaderDone = useRef(false)
  const [loaderDoneState, setLoaderDoneFlag] = useState(false)
  const setLoaderDone = useCallback((v: boolean) => {
    loaderDone.current = v
    setLoaderDoneFlag(v)
  }, [])
  const prevShowPicker = useRef(false)
  const { exit } = useApp()
  const { cols, rows, resizing, live } = useTerminalSize()

  // DEGRADED-only in-process web fallback (decision #1). In CONNECTED mode the
  // daemon IS the web server and `w` just opens its URL (no in-process server,
  // no start/stop chrome — decision #3 deleted webStatus/webUrl/etc.). This ref
  // holds a degraded fallback server so the unmount cleanup can stop it; the
  // boolean guards a concurrent start.
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
  // Tracks the active tab for the once-registered scroll handler (P12), so the
  // mouse/stdin effect doesn't tear down + re-attach (and re-issue the mode-
  // disable TTY write) on every Dashboard<->Table switch.
  const tabRef = useRef(0)
  tabRef.current = tab
  const dashPageCountRef = useRef(1)
  const seededRef = useRef(false)
  // Bracketed-paste handling. `pasteBufRef` accumulates the payload across stdin
  // chunks once \x1b[200~ is seen, until \x1b[201~ closes it. `insertPasteRef`
  // is kept fresh every render so the data tap (registered once) inserts into
  // whatever field is focused right now without stale-closure bugs.
  const pasteBufRef = useRef<string | null>(null)
  // Carries the last few bytes of a chunk that had no paste marker yet, so a
  // marker split across a chunk boundary (e.g. "...\x1b[20" then "0~...") is
  // still recognized on the next chunk. Only used while NOT mid-paste.
  const pasteCarryRef = useRef<string>('')
  const insertPasteRef = useRef<(text: string) => void>(() => {})
  // Live value+caret mirrors for the two non-form text inputs (tz editor, table
  // search). Synced from state each render so external changes (open/clear/switch)
  // are reflected, and mutated synchronously by edits so back-to-back keystrokes
  // before a re-render compose correctly (state is async). The account-form caret
  // lives in accountForm itself (atomic functional setState, no ref needed).
  const tzValueRef = useRef('')
  const tzCaretRef = useRef(0)
  const searchValueRef = useRef('')
  const searchCaretRef = useRef(0)
  const accountsKey = useMemo(() => accounts.map(acctKey).join('|'), [accounts])

  // ── Render source: daemon snapshot (CONNECTED) vs in-process state (DEGRADED).
  // In CONNECTED mode stats/peak/updated are PROJECTED from the daemon snapshot
  // via the adapter (view scoping stays client-side: the snapshot ships ALL
  // resolved accounts and we map them onto our own resolved Account[], which
  // carry the config/named colors). In DEGRADED mode they come from the local
  // state the in-process effects populate.
  const snapshot = daemon.snapshot
  const stats = useMemo(
    () => connected ? toStatsMap(snapshot, accounts) : statsLocal,
    [connected, snapshot, accounts, statsLocal],
  )
  // Gate the peak badge on whether the TUI's VISIBLE accounts (which honor
  // config.disabledProviders) include a claude account. The daemon resolves with
  // disabledProviders:[] so snapshot.peak is present even for a disabled-but-
  // configured claude account; the DEGRADED path only fetches peak when claude is
  // a built (non-disabled) account, so this keeps CONNECTED parity.
  const showPeak = accounts.some(a => a.providerId === 'claude')
  const peak = connected ? (showPeak ? (snapshot?.peak ?? null) : null) : peakLocal
  const updated = useMemo(
    () => connected ? new Date(snapshot?.generatedAt ?? Date.now()) : updatedLocal,
    [connected, snapshot, updatedLocal],
  )
  // Header refresh-interval label. CONNECTED reflects the daemon's EFFECTIVE
  // interval (it floors summary at 8s — snapshot.intervalMs carries the floored
  // value), so the header isn't misleading for sub-8s configs; DEGRADED uses the
  // un-floored in-process interval as before.
  const intervalLabel = connected && snapshot?.intervalMs
    ? Math.round(snapshot.intervalMs / 1000)
    : cfg.interval
  // Per-account readiness input, source-agnostic. CONNECTED reads the snapshot's
  // fetch-state maps (resolving the dashboard===null ambiguity); DEGRADED falls
  // back to presence via statsReadyInput.
  const readyInputFor = useCallback((id: string): ReadyInput | undefined => {
    if (connected) {
      const wa = snapshot?.accounts.find(a => a.id === id)
      if (!wa) return undefined
      return { summaryState: wa.summaryState, billingState: wa.billingState, billing: wa.billing }
    }
    return statsReadyInput(statsLocal.get(id))
  }, [connected, snapshot, statsLocal])

  // Memoize the slot chain so its array identities only change when accounts or
  // the active account change — gives the React.memo'd leaf views (AccountStrip,
  // DashboardView, TotalsRow) stable props so a cursor/scroll/poll key doesn't
  // re-render them. accounts is already memoized (:204).
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
  // Call accountsByProvider(accounts) ONCE (allGroups) and derive both the table
  // provider list and the focus-scoped groups from it.
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

  // Keep the live value+caret mirrors in sync with state each render so external
  // mutations (tz opened with prefill, search cleared on esc / provider switch,
  // backspace, caret-move) are reflected before the next edit reads the ref.
  tzValueRef.current = tzEdit ?? ''
  tzCaretRef.current = clampCaret(tzCaret, (tzEdit ?? '').length)
  searchValueRef.current = search
  searchCaretRef.current = clampCaret(searchCaret, search.length)

  // True for a real typed printable run (not a control/meta combo or a bracketed-
  // paste payload). Single predicate replacing the 4 duplicated inline gates.
  const isPrintable = (input: string, key: { ctrl: boolean; meta: boolean }): boolean =>
    !!input && !key.ctrl && !key.meta && !isPasteInput(input)

  // Single text-insertion path shared by the typed-char branches in useInput AND
  // the paste tap (insertPasteRef). Owns the field-routing priority
  // (settings form > tz > search) and splices `text` at the focused field's caret,
  // advancing the caret past the inserted run. Defined as a render-body closure
  // (re-created each render) so it always sees the currently focused field with no
  // stale-closure bug — same lifetime model as insertPasteRef.current.
  const insertText = (text: string): void => {
    if (showSettings && accountForm && (accountForm.field === 'name' || accountForm.field === 'homeDir')) {
      setAccountForm(f => {
        if (!f || (f.field !== 'name' && f.field !== 'homeDir')) return f
        const r = spliceInsert(f[f.field], f.caret, text)
        return { ...f, [f.field]: r.value, caret: r.caret, error: null }
      })
    } else if (showSettings && tzEdit !== null) {
      // tzValueRef/tzCaretRef are the LIVE value+caret (mutated synchronously so
      // back-to-back edits before a re-render compose correctly); state mirrors
      // only drive the render.
      const r = spliceInsert(tzValueRef.current, tzCaretRef.current, text)
      tzValueRef.current = r.value; tzCaretRef.current = r.caret
      setTzEdit(r.value); setTzCaret(r.caret); setTzError(null)
    } else if (tab === 1 && searchMode) {
      const r = spliceInsert(searchValueRef.current, searchCaretRef.current, text)
      searchValueRef.current = r.value; searchCaretRef.current = r.caret
      setSearch(r.value); setSearchCaret(r.caret)
    }
  }
  // Refreshed each render so the once-registered paste tap always targets the
  // currently focused field (same priority as the useInput handler below).
  insertPasteRef.current = insertText

  const effTableProvider = (tableProvider && tableProvs.includes(tableProvider)) ? tableProvider : (tableProvs[0] ?? null)
  const tableIsCursor = !!effTableProvider && !PROVIDERS[effTableProvider].hasUsage
  const tableAccounts = useMemo(
    () => effTableProvider ? accounts.filter(a => a.providerId === effTableProvider) : [],
    [accounts, effTableProvider],
  )
  const SORTS_FOR = tableIsCursor ? CURSOR_SORTS : SORTS

  // CONNECTED: project the table + cursor rows from the daemon's already-fetched
  // per-account data (no client-side fetch). DEGRADED: use the local state the
  // in-process table effect fills.
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

  // ── DEGRADED-only: cache seed (read-only). The daemon is the SOLE writer of
  // web-snapshot.json; here we only READ it to seed the in-process view from a
  // prior connected session. The TUI never writes the cache (one writer only).
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
    // Fast load: allReady before the loader was ever shown — latch done now. This
    // is the site the old ref-only write left non-reactive (P15): setLoaderDone
    // flips the state mirror so showLoader re-evaluates and the loader clears.
    if (loaderShownAt === null) { setLoaderDone(true); return }
    setGraceHold(true)
    const minRemaining = Math.max(0, LOADER_MIN_VISIBLE_MS - (Date.now() - loaderShownAt))
    const hold = Math.max(LOADER_GRACE_MS, minRemaining)
    const t = setTimeout(() => { setLoaderDone(true); setGraceHold(false) }, hold)
    return () => clearTimeout(t)
    // loaderShownAt in deps (P15): if allReady flips true before loaderShownAt is
    // set, the run above takes the immediate-latch branch; re-running once
    // loaderShownAt lands lets the min-visible/grace hold compute against the real
    // timestamp instead of being skipped. Idempotent: the loaderDone.current guard
    // short-circuits a re-run after the latch, and the cleanup clears any pending
    // timeout so only one hold is ever in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady, loaderShownAt])

  // ── DEGRADED-only: in-process summary loop. CONNECTED mode reads dashboards
  // from the daemon snapshot via toStatsMap.
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

  // ── DEGRADED-only: in-process billing + peak loop. CONNECTED mode reads
  // billing from the snapshot and peak from snapshot.peak.
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
    // Clear any stranded spinner (P13b): if tableKey changes while tab!==1 (e.g.
    // tz edited from settings), the degraded fetch effect early-returns and never
    // clears a previously-true tableLoading, leaving a stuck spinner on the next
    // Table visit. Connected mode never sets tableLoading, so this is a no-op there.
    setTableLoading(false)
  }, [tableKey])

  // ── DEGRADED-only: in-process table/cursor fetch loop. CONNECTED mode projects
  // the table via pickTable and cursor rows via toCursorRows from the snapshot.
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

  // Bracketed-paste consumer for the raw stdin tap. Bracketed paste is enabled
  // in cli.tsx (\x1b[?2004h), so a paste arrives as \x1b[200~<payload>\x1b[201~,
  // possibly split across several stdin chunks (the TTY chunks at arbitrary byte
  // boundaries on large/fast pastes). We buffer between the markers, run the
  // payload through sanitizeTyped, and insert it as ONE setState into the focused
  // field. Returns true while a paste is being consumed so the caller skips
  // feeding those bytes to dispatchLinkClicks. Stable ([] deps): reads everything
  // through refs to avoid stale closures.
  //
  // Robustness: both START and END markers may straddle a chunk boundary, so we
  // always scan the combined buffer (carry/buffer + new chunk) rather than the
  // raw chunk alone, and keep a trailing carry of the bytes that could be the
  // prefix of a marker. A safety cap bounds the buffer so a malformed/never-
  // closed paste can never permanently freeze input.
  const PASTE_START = '\x1b[200~'
  const PASTE_END = '\x1b[201~'
  const PASTE_MAX = 1 << 20 // 1 MiB: flush+abort a runaway paste rather than wedge input
  const handlePasteData = useCallback((chunk: Buffer | string): boolean => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

    // Mid-paste: search the COMBINED buffer so a split end marker is still found.
    if (pasteBufRef.current !== null) {
      const combined = pasteBufRef.current + s
      const end = combined.indexOf(PASTE_END)
      if (end === -1) {
        // No end yet. Safety cap: if the paste grows without ever closing, flush
        // what we have and abort so input is never permanently swallowed.
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
      // Anything after the end marker is normal input; let Ink/useInput see it.
      return end + PASTE_END.length >= combined.length
    }

    // Not mid-paste: scan carry + chunk so a split START marker is recognized.
    const combined = pasteCarryRef.current + s
    const start = combined.indexOf(PASTE_START)
    if (start === -1) {
      // No start marker. Retain a trailing tail that could be the prefix of a
      // START marker (split across the next chunk); pass the rest through.
      const keep = Math.min(combined.length, PASTE_START.length - 1)
      pasteCarryRef.current = combined.slice(combined.length - keep)
      return false
    }
    pasteCarryRef.current = ''
    const rest = combined.slice(start + PASTE_START.length)
    const end = rest.indexOf(PASTE_END)
    if (end === -1) {
      // Multi-chunk paste: open the buffer and wait for the rest.
      pasteBufRef.current = rest
      return true
    }
    // Whole paste in one chunk.
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
    // ink-mouse's enable() turns on 1000 (button/click) + 1003 (any-motion) +
    // 1015 (urxvt ext) + 1006 (SGR ext). Motion tracking floods stdin with
    // \x1b[<35;..M reports on every cursor move, which lag the UI and leak into
    // text fields. Drop motion (1003/1002) + urxvt (1015), keep click (1000) +
    // SGR (1006). Wheel scroll still arrives: it's reported as button events
    // (codes 64/65) under mode 1000, so the scroll handler below keeps working.
    if (process.stdout.isTTY) {
      try { process.stdout.write('\x1b[?1003l\x1b[?1002l\x1b[?1015l') } catch {}
    }
    const onScroll = (_pos: { x: number; y: number }, dir: string | null) => {
      const up = dir === 'scrollup'
      const t = tabRef.current
      if (t === 1) {
        // Clamp scroll-down to the row count (clampRow reads rowCountRef, set
        // each render) so wheeling past the last row can't drive the highlight
        // off the end — matching every keyboard nav path (P11).
        setCursor(c => up ? Math.max(0, c - 3) : clampRow(c + 3))
      } else if (t === 0 && dashPageCountRef.current > 1) {
        setDashPage(p => up ? Math.max(0, p - 1) : Math.min(dashPageCountRef.current - 1, p + 1))
      }
    }
    mouse.events.on('scroll', onScroll)
    const onData = (d: Buffer | string) => { if (!handlePasteData(d)) dispatchLinkClicks(d) }
    process.stdin.on('data', onData)
    return () => { mouse.events.off('scroll', onScroll); process.stdin.off('data', onData) }
    // Register once for the session: read `tab` via tabRef so a tab switch
    // doesn't re-bind listeners or re-issue the TTY mode-disable write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Config writes. CONNECTED: optimistically apply locally (so view scoping —
  // focus/provider toggles/layout — reacts instantly), then PUT to the daemon,
  // which normalizes + persists + live-reloads its engine and broadcasts a
  // `config` event we reconcile from (see the daemon.config effect below). The
  // daemon is the sole saveConfig caller in this mode. DEGRADED: write to disk
  // directly, exactly as before.
  // Functional setState so two config-mutating keypresses before a re-render
  // serialize (the second reads the first's result, not a stale render closure).
  // The persistence side-effect fires INSIDE the updater: Ink's reconciler runs
  // it synchronously and exactly once (tokmon mounts <App> with no StrictMode),
  // so `next` is always the real value — firing it after setConfig would read an
  // undefined `next` because the updater is deferred, silently dropping every
  // write (onboarding/settings/accounts never persisted). saveConfig + the daemon
  // PUT are both idempotent, so a stray re-invoke is harmless. useCallback keeps
  // the identity stable for the cycle* handlers (P2) that depend on it.
  const updateConfig = useCallback((fn: (prev: Config) => Config): void => {
    setConfig(prev => {
      const next = fn(prev ?? DEFAULTS)
      if (connected) { void daemon.setConfig(next).catch(() => {}) }
      else void saveConfig(next)
      return next
    })
  }, [connected, daemon])

  // Reconcile the optimistic config with the daemon's normalized echo (arrives
  // on the WS config stream after a successful setConfig). The echo is the full
  // normalized Config (activeAccountId/focus included), so we adopt it verbatim
  // — NOT through applyStartup, which would re-zero the focus. Cheap equality
  // guard avoids a redundant re-render when the normalized form is unchanged.
  const daemonConfig = daemon.config
  useEffect(() => {
    if (!connected || !daemonConfig) return
    setConfig(prev => {
      if (prev && deepEqual(prev, daemonConfig)) return prev
      return daemonConfig
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
    // Reset sort synchronously from the TARGET provider's kind (P13a). The
    // tableKey effect does this one commit later; without the synchronous reset
    // SORTS_FOR (cursor vs token) would index the OLD sort against the NEW array
    // for one frame, briefly showing a wrong sort label/order.
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
      // Land the caret at end-of-value when entering a text field.
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

  // w/W (decision #3): CONNECTED just opens the browser at the already-running
  // daemon's URL — no start/stop chrome, the daemon's lifecycle is the TUI's.
  // DEGRADED (decision #1): start the in-process web server once (lazily) and
  // open the browser; a second press reuses the running server's URL.
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

  // Stable click/select handlers for the React.memo'd leaf views (P1). Deps are
  // now stable from P3 (slots memoized) + P6 (updateConfig/resetView useCallback),
  // so these identities only change when their real inputs change — letting e.g.
  // TabBar/AccountStrip bail out on a cursor/scroll/poll re-render.
  const onTabSelect = useCallback((i: number) => { setTab(i); resetView() }, [resetView])
  const onStripSelect = useCallback((i: number) => {
    updateConfig(c => ({ ...c, activeAccountId: slots[i].id })); resetView()
  }, [slots, updateConfig, resetView])
  const onProviderSelect = useCallback((p: ProviderId) => {
    setTableProvider(p); setCursor(0); setExpanded(-1); setSearch(''); setSearchCaret(0); setSearchMode(false)
  }, [])
  // Legitimately depends on `cursor`: it changes when the cursor moves, which only
  // re-renders TokenTable (the view that owns the cursor) — correct and cheap.
  const onRowClickToken = useCallback((idx: number) => {
    if (idx === cursor) setExpanded(e => e === idx ? -1 : idx); else setCursor(idx)
  }, [cursor])
  const onRowClickCursor = useCallback((idx: number) => setCursor(idx), [])

  // Filter+sort the visible table ONCE per relevant change instead of on every
  // render (dashboard keystroke/scroll/poll, or a Table-tab cursor move that
  // doesn't touch table/view/search/sort). Each path returns [] when its tab/mode
  // isn't active so the work is skipped entirely off-tab. rowCountRef (set in the
  // render body just before return) stays in sync because the memos run each
  // render; clampRow inside useInput reads the ref, which is only consulted on
  // the Table tab.
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
      // Submit from ANY field (P9): ctrl+s commits the form (color has a sane
      // default; commit re-validates name as the backstop). ctrl chosen so it
      // can't collide with the caret ctrl+a/ctrl+e below.
      if (key.ctrl && input === 's') { commitAccountForm(); return }
      if (key.tab) { cycleFormField(key.shift ? -1 : 1); return }
      if (key.upArrow) { cycleFormField(-1); return }
      if (key.downArrow) { cycleFormField(1); return }
      if (accountForm.field === 'provider') {
        if (key.leftArrow) { cycleProvider(-1); return }
        if (key.rightArrow) { cycleProvider(1); return }
        // Advance into Name with the caret at its end.
        if (key.return) { setAccountForm(f => f && { ...f, field: 'name', caret: f.name.length }); return }
        return
      }
      if (accountForm.field === 'color') {
        if (key.leftArrow) { cycleColor(-1); return }
        if (key.rightArrow) { cycleColor(1); return }
        if (key.return) { commitAccountForm(); return }
        return
      }
      // TEXT fields (name/homeDir): left/right move the caret intra-field; Home/
      // End/ctrl+a/ctrl+e jump to the edges; backspace deletes at the caret;
      // typed chars splice at the caret (via insertText).
      const tf = accountForm.field as 'name' | 'homeDir'
      if (key.leftArrow) { setAccountForm(f => f && { ...f, caret: clampCaret(f.caret - 1, f[tf].length) }); return }
      if (key.rightArrow) { setAccountForm(f => f && { ...f, caret: clampCaret(f.caret + 1, f[tf].length) }); return }
      // Home/End via ctrl+a / ctrl+e (Ink doesn't map the Home/End keys).
      if (key.ctrl && input === 'a') { setAccountForm(f => f && { ...f, caret: 0 }); return }
      if (key.ctrl && input === 'e') { setAccountForm(f => f && { ...f, caret: f[tf].length }); return }
      if (key.return) {
        // Eagerly validate Name when leaving it (P9): blank name stays put with
        // the error instead of walking the user to Color before bouncing back.
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
      // Caret nav (intra-field): left/right + ctrl+a/ctrl+e (Home/End).
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
      // Caret nav (intra-field): left/right + ctrl+a/ctrl+e (Home/End).
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
    // Web toggle: `W` anywhere, plus lowercase `w` outside the Table tab (where
    // `w` = Weekly). Gated until the initial load finishes rendering the dashboard.
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
      // Dashboard owns no list cursor: page nav when paginated, otherwise the
      // cursor/page keys no-op. Return unconditionally so up/down/G/g/pageUp/
      // pageDown can't fall through to the generic cursor handlers below and
      // silently mutate the invisible Table cursor (a dead re-render that also
      // desyncs the cursor for the next Table visit) (P10).
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

    // Row-cursor nav belongs only to the interactive (token) Table. Scope it so
    // cursor moves never fire on the Dashboard (already returned above) or on a
    // non-interactive cursor table — no dead re-renders, no cursor desync (P10).
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
