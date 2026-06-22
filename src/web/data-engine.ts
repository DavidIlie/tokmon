import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { DashboardData, TableData } from '../types'
import type { BillingResult } from '../providers/types'
import { cacheDir } from '../config'
import { fetchPeak } from '../peak'
import {
  assembleSnapshot, fetchAccountBilling, fetchAccountSummary, fetchAccountTable,
  type ResolvedAccount,
} from './data'
import type { WebSnapshot, AccountFetchState, PeakStatus } from './contract'
import type { Config } from '../config-schema'

const TABLE_INTERVAL_MS = 300_000
const PEAK_INTERVAL_MS = 300_000
const IDLE_PAUSE_MS = 60_000
const SNAPSHOT_CACHE_THROTTLE_MS = 20_000
// Throttle the incremental rebuild() emitted inside per-account loops so a long
// list of accounts reveals progressively without flooding WS subscribers.
const REVEAL_THROTTLE_MS = 500
const snapshotCacheFile = () => join(cacheDir(), 'web-snapshot.json')

// Which refresh loops an RPC refresh should kick. 'all' forces every loop.
export type RefreshScope = 'all' | 'summary' | 'table' | 'billing' | 'peak'

interface DataEngineOptions {
  version: string
  config: Config
  tz: string
  summaryIntervalMs: number
  billingIntervalMs: number
  resolved: ResolvedAccount[]
}

export interface DataEngine {
  snapshot(): WebSnapshot | null
  start(): void
  subscribe(onSnapshot: (snapshot: WebSnapshot) => void): () => void
  subscribeConfig(onConfig: (config: Config) => void): () => void
  touch(): void
  refresh(scope?: RefreshScope): void
  // Live-reload the resolved account set (after a config PUT) without dropping
  // surviving accounts' already-fetched data. tz/interval changes apply too.
  setConfig(next: { resolved: ResolvedAccount[]; tz: string; summaryIntervalMs: number; billingIntervalMs: number }): void
  // Broadcast a config value to every WS config stream subscriber.
  broadcastConfig(config: Config): void
  stop(): void
}

export function createDataEngine(opts: DataEngineOptions): DataEngine {
  const { version } = opts
  // tz / intervals / resolved are mutable so setConfig() can live-reload them.
  let tz = opts.tz
  let summaryIntervalMs = opts.summaryIntervalMs
  let billingIntervalMs = opts.billingIntervalMs
  let resolved = opts.resolved
  let currentConfig = opts.config

  const usage = new Map<string, { dashboard: DashboardData | null; table: TableData | null }>()
  const billing = new Map<string, BillingResult | null>()
  const summaryState = new Map<string, AccountFetchState>()
  const billingState = new Map<string, AccountFetchState>()
  const tableState = new Map<string, AccountFetchState>()
  let peak: PeakStatus | null = null
  // true while serving cache-hydrated data; flipped false on first live rebuild.
  let seeded = false
  let current: WebSnapshot | null = null
  const snapshotSubscribers = new Set<(snapshot: WebSnapshot) => void>()
  const configSubscribers = new Set<(config: Config) => void>()
  let lastActivity = Date.now()
  let stopped = false
  let summaryTimer: ReturnType<typeof setInterval> | undefined
  let tableTimer: ReturnType<typeof setInterval> | undefined
  let billingTimer: ReturnType<typeof setInterval> | undefined
  let peakTimer: ReturnType<typeof setInterval> | undefined

  let lastPersist = 0
  let lastReveal = 0

  // Bumped on every setConfig(). Each refresh loop captures the epoch at entry
  // and abandons its writes if the config changed mid-fetch — so an in-flight
  // loop started under the OLD config can never clobber the reconciled maps
  // (no stale data for edited accounts, no orphaned entries for removed ones).
  let configEpoch = 0

  // Only poll the global peak clock if at least one resolved account is claude.
  let hasClaude = resolved.some(r => r.account.providerId === 'claude')

  const idle = () => snapshotSubscribers.size === 0 && Date.now() - lastActivity > IDLE_PAUSE_MS

  const usageEntry = (id: string) => {
    let u = usage.get(id)
    if (!u) { u = { dashboard: null, table: null }; usage.set(id, u) }
    return u
  }

  const buildSnapshot = (): WebSnapshot => assembleSnapshot({
    version, tz, intervalMs: summaryIntervalMs, resolved, usage, billing,
    summaryState, billingState, tableState, seeded, peak,
  })

  const hydrateFromCache = () => {
    try {
      const cached = JSON.parse(readFileSync(snapshotCacheFile(), 'utf-8')) as WebSnapshot
      if (!cached || !Array.isArray(cached.accounts)) return
      for (const a of cached.accounts) {
        if (a.dashboard || a.table) {
          usage.set(a.id, { dashboard: a.dashboard, table: a.table })
          if (a.dashboard) summaryState.set(a.id, 'ready')
          if (a.table) tableState.set(a.id, 'ready')
        }
        if (a.billing) { billing.set(a.id, a.billing); billingState.set(a.id, 'ready') }
      }
      seeded = true
      current = buildSnapshot()
    } catch {}
  }

  const persist = () => {
    if (!current) return
    if (!current.accounts.some(a => a.hasUsage && a.table != null)) return
    if (Date.now() - lastPersist < SNAPSHOT_CACHE_THROTTLE_MS) return
    lastPersist = Date.now()
    try {
      mkdirSync(cacheDir(), { recursive: true, mode: 0o700 })
      // Atomic write (tmp + rename, like lockfile.ts): if more than one tokmon
      // process runs concurrently (e.g. `tokmon serve` + a TUI's spawned child),
      // last-writer-wins instead of a torn/corrupt JSON read by the other side.
      // 0o600: the snapshot holds usage/billing data — keep it owner-only.
      const tmp = join(cacheDir(), `web-snapshot.json.${process.pid}.tmp`)
      writeFileSync(tmp, JSON.stringify(current), { mode: 0o600 })
      renameSync(tmp, snapshotCacheFile())
    } catch {}
  }

  const rebuild = () => {
    if (stopped) return
    // First live data supersedes any cache-hydrated view.
    seeded = false
    current = buildSnapshot()
    persist()
    for (const onSnapshot of snapshotSubscribers) {
      try { onSnapshot(current) } catch {}
    }
  }

  // Throttled rebuild for use INSIDE the per-account fetch loops so a long
  // account list reveals progressively. The trailing rebuild() after each loop
  // guarantees the final state always flushes.
  const reveal = () => {
    if (stopped) return
    if (Date.now() - lastReveal < REVEAL_THROTTLE_MS) return
    lastReveal = Date.now()
    rebuild()
  }

  let usageAccounts = resolved.filter(r => r.hasUsage)
  let billingAccounts = resolved.filter(r => r.hasBilling)

  // Each loop guards against (a) idle pausing (unless forced), and (b) a
  // concurrent run. A FORCED call that lands while the loop is busy can't run
  // immediately, so it sets a *ForcePending flag the in-flight run re-checks in
  // its finally and re-invokes itself — this makes setConfig()/RPC refresh
  // deterministically re-fetch (e.g. a just-added account) instead of being
  // silently dropped until the next interval timer (up to 5 min for the table).
  let summaryBusy = false
  let summaryForcePending = false
  const refreshSummary = async (force = false): Promise<void> => {
    if (stopped) return
    if (summaryBusy) { if (force) summaryForcePending = true; return }
    if (!force && idle()) return
    const epoch = configEpoch
    summaryBusy = true
    try {
      for (const r of usageAccounts) {
        if (stopped) return
        let dashboard: DashboardData | null = null
        let ok = true
        try { dashboard = await fetchAccountSummary(r.account, tz) } catch { ok = false }
        // Config changed mid-fetch -> abandon this write so we never clobber the
        // reconciled maps (stale data for edited ids / orphans for removed ids).
        if (stopped || epoch !== configEpoch) return
        if (ok) { usageEntry(r.account.id).dashboard = dashboard; summaryState.set(r.account.id, 'ready') }
        else summaryState.set(r.account.id, 'error')
        reveal()
      }
      rebuild()
    } finally {
      summaryBusy = false
      if (summaryForcePending && !stopped) { summaryForcePending = false; void refreshSummary(true) }
    }
  }

  let tableBusy = false
  let tableForcePending = false
  const refreshTable = async (force = false): Promise<void> => {
    if (stopped) return
    if (tableBusy) { if (force) tableForcePending = true; return }
    if (!force && idle()) return
    const epoch = configEpoch
    tableBusy = true
    try {
      for (const r of usageAccounts) {
        if (stopped) return
        let table: TableData | null = null
        let ok = true
        try { table = await fetchAccountTable(r.account, tz) } catch { ok = false }
        if (stopped || epoch !== configEpoch) return
        if (ok) { usageEntry(r.account.id).table = table; tableState.set(r.account.id, 'ready') }
        else tableState.set(r.account.id, 'error')
        reveal()
      }
      rebuild()
    } finally {
      tableBusy = false
      if (tableForcePending && !stopped) { tableForcePending = false; void refreshTable(true) }
    }
  }

  let billingBusy = false
  let billingForcePending = false
  const refreshBilling = async (force = false): Promise<void> => {
    if (stopped) return
    if (billingBusy) { if (force) billingForcePending = true; return }
    if (!force && idle()) return
    const epoch = configEpoch
    billingBusy = true
    try {
      for (const r of billingAccounts) {
        if (stopped) return
        let result: BillingResult | null = null
        let ok = true
        try { result = await fetchAccountBilling(r.account) } catch { ok = false }
        if (stopped || epoch !== configEpoch) return
        if (ok) { billing.set(r.account.id, result); billingState.set(r.account.id, 'ready') }
        else billingState.set(r.account.id, 'error')
        reveal()
      }
      rebuild()
    } finally {
      billingBusy = false
      if (billingForcePending && !stopped) { billingForcePending = false; void refreshBilling(true) }
    }
  }

  let peakBusy = false
  const refreshPeak = async (force = false) => {
    if (stopped || peakBusy || !hasClaude || (!force && idle())) return
    peakBusy = true
    try {
      const next = await fetchPeak()
      // Keep the last known value on a null fetch (transient failure).
      if (next) { peak = next; rebuild() }
    } finally {
      peakBusy = false
    }
  }

  // Tear down the polling timers WITHOUT marking the engine stopped, so
  // setConfig() can rebuild them. (stop() additionally sets `stopped`.)
  const clearTimers = () => {
    clearInterval(summaryTimer); summaryTimer = undefined
    clearInterval(tableTimer); tableTimer = undefined
    clearInterval(billingTimer); billingTimer = undefined
    clearInterval(peakTimer); peakTimer = undefined
  }

  const startTimers = () => {
    summaryTimer = setInterval(() => { void refreshSummary() }, summaryIntervalMs)
    tableTimer = setInterval(() => { void refreshTable() }, TABLE_INTERVAL_MS)
    billingTimer = setInterval(() => { void refreshBilling() }, billingIntervalMs)
    summaryTimer.unref?.()
    tableTimer.unref?.()
    billingTimer.unref?.()
    if (hasClaude) {
      peakTimer = setInterval(() => { void refreshPeak() }, PEAK_INTERVAL_MS)
      peakTimer.unref?.()
    }
  }

  hydrateFromCache()

  return {
    snapshot: () => current,

    start() {
      void refreshSummary(true)
      void refreshTable(true)
      void refreshBilling(true)
      if (hasClaude) void refreshPeak(true)
      startTimers()
    },

    touch() { lastActivity = Date.now() },

    refresh(scope = 'all') {
      if (stopped) return
      if (scope === 'all' || scope === 'summary') void refreshSummary(true)
      if (scope === 'all' || scope === 'table') void refreshTable(true)
      if (scope === 'all' || scope === 'billing') void refreshBilling(true)
      if ((scope === 'all' || scope === 'peak') && hasClaude) void refreshPeak(true)
    },

    setConfig(next) {
      if (stopped) return
      // 1. Stop the polling loops. In-flight async fetches keep running but, via
      //    the configEpoch bump below, abandon their writes so they can't clobber
      //    the reconciled maps (surviving accounts keep their data in step 3).
      clearTimers()

      // 2. Bump the epoch FIRST (same synchronous block as the swaps): any loop
      //    that captured the old epoch will see epoch !== configEpoch after its
      //    next await and bail before writing.
      configEpoch++

      // 3. Swap in the new resolution + tz/interval settings.
      tz = next.tz
      summaryIntervalMs = next.summaryIntervalMs
      billingIntervalMs = next.billingIntervalMs
      resolved = next.resolved
      hasClaude = resolved.some(r => r.account.providerId === 'claude')
      // Last claude account removed -> clear the stale peak clock so the snapshot
      // doesn't keep emitting a peak/off-peak badge for a config without claude.
      if (!hasClaude) peak = null
      usageAccounts = resolved.filter(r => r.hasUsage)
      billingAccounts = resolved.filter(r => r.hasBilling)

      // 4. Reconcile the data/state maps: KEEP data for surviving account ids,
      //    drop entries for removed accounts, leave new accounts to default
      //    'pending' (their first fetch fills them in).
      const survivors = new Set(resolved.map(r => r.account.id))
      for (const id of [...usage.keys()]) if (!survivors.has(id)) usage.delete(id)
      for (const id of [...billing.keys()]) if (!survivors.has(id)) billing.delete(id)
      for (const map of [summaryState, billingState, tableState]) {
        for (const id of [...map.keys()]) if (!survivors.has(id)) map.delete(id)
      }

      // 5. Re-emit immediately so clients see the reconciled account set, then
      //    restart the loops + a forced fetch for the (possibly) new accounts.
      //    The forced fetches re-arm via *ForcePending if an old-epoch loop is
      //    still draining, so the new config's data lands promptly regardless.
      rebuild()
      void refreshSummary(true)
      void refreshTable(true)
      void refreshBilling(true)
      if (hasClaude) void refreshPeak(true)
      startTimers()
    },

    broadcastConfig(config) {
      if (stopped) return
      currentConfig = config
      for (const onConfig of configSubscribers) {
        try { onConfig(config) } catch {}
      }
    },

    subscribe(onSnapshot) {
      if (current) {
        try { onSnapshot(current) } catch {}
      }
      snapshotSubscribers.add(onSnapshot)
      lastActivity = Date.now()
      if (!current || Date.now() - current.generatedAt > summaryIntervalMs) {
        void refreshSummary(true)
        void refreshTable(true)
      }
      return () => { snapshotSubscribers.delete(onSnapshot) }
    },

    subscribeConfig(onConfig) {
      try { onConfig(currentConfig) } catch {}
      configSubscribers.add(onConfig)
      return () => { configSubscribers.delete(onConfig) }
    },

    stop() {
      stopped = true
      clearTimers()
      snapshotSubscribers.clear()
      configSubscribers.clear()
    },
  }
}
