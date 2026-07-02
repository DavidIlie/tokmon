import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import type { DashboardData, TableData } from '../types'
import type { BillingResult } from '../providers/types'
import { cacheDir, snapshotCacheFile } from '../config'
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
const REVEAL_THROTTLE_MS = 500
const FETCH_TIMEOUT_MS = 30_000

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error('fetch timeout')), ms)
      t.unref?.()
    }),
  ])

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
  setConfig(next: { resolved: ResolvedAccount[]; tz: string; summaryIntervalMs: number; billingIntervalMs: number }): void
  broadcastConfig(config: Config): void
  stop(): void
}

export function createDataEngine(opts: DataEngineOptions): DataEngine {
  const { version } = opts
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

  // Bumped on setConfig(); in-flight loops bail if epoch changed to avoid clobbering reconciled maps.
  let configEpoch = 0

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
      mkdirSync(cacheDir(), { recursive: true, mode: 0o700 }) // 0o700: owner-only usage data
      const tmp = `${snapshotCacheFile()}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(current), { mode: 0o600 })
      renameSync(tmp, snapshotCacheFile())
    } catch {}
  }

  const rebuild = () => {
    if (stopped) return
    seeded = false
    current = buildSnapshot()
    persist()
    for (const onSnapshot of snapshotSubscribers) {
      try { onSnapshot(current) } catch {}
    }
  }

  const reveal = () => {
    if (stopped) return
    if (Date.now() - lastReveal < REVEAL_THROTTLE_MS) return
    lastReveal = Date.now()
    rebuild()
  }

  let usageAccounts = resolved.filter(r => r.hasUsage)
  let billingAccounts = resolved.filter(r => r.hasBilling)

  // One skeleton for the three account-refresh loops. Each keeps a busy flag and
  // a forcePending flag so a forced call that lands mid-run re-invokes after the
  // in-flight run finishes; in-flight results are dropped when the config epoch moves.
  const makeRefreshLoop = <T,>(opts: {
    accounts: () => ResolvedAccount[]
    fetch: (r: ResolvedAccount) => Promise<T>
    apply: (id: string, value: T) => void
    state: Map<string, AccountFetchState>
  }): ((force?: boolean) => Promise<void>) => {
    let busy = false
    let forcePending = false
    const run = async (force = false): Promise<void> => {
      if (stopped) return
      if (busy) { if (force) forcePending = true; return }
      if (!force && idle()) return
      const epoch = configEpoch
      busy = true
      try {
        for (const r of opts.accounts()) {
          if (stopped) return
          let value: T | null = null
          let ok = true
          try { value = await withTimeout(opts.fetch(r), FETCH_TIMEOUT_MS) } catch { ok = false }
          if (stopped || epoch !== configEpoch) return
          if (ok) { opts.apply(r.account.id, value as T); opts.state.set(r.account.id, 'ready') }
          else opts.state.set(r.account.id, 'error')
          reveal()
        }
        rebuild()
      } finally {
        busy = false
        if (forcePending && !stopped) { forcePending = false; void run(true) }
      }
    }
    return run
  }

  const refreshSummary = makeRefreshLoop({
    accounts: () => usageAccounts,
    fetch: r => fetchAccountSummary(r.account, tz),
    apply: (id, dashboard) => { usageEntry(id).dashboard = dashboard },
    state: summaryState,
  })

  const refreshTable = makeRefreshLoop({
    accounts: () => usageAccounts,
    fetch: r => fetchAccountTable(r.account, tz),
    apply: (id, table) => { usageEntry(id).table = table },
    state: tableState,
  })

  const refreshBilling = makeRefreshLoop({
    accounts: () => billingAccounts,
    fetch: r => fetchAccountBilling(r.account, tz),
    apply: (id, result) => { billing.set(id, result) },
    state: billingState,
  })

  let peakBusy = false
  const refreshPeak = async (force = false) => {
    if (stopped || peakBusy || !hasClaude || (!force && idle())) return
    const epoch = configEpoch
    peakBusy = true
    try {
      const next = await fetchPeak()
      if (stopped || epoch !== configEpoch || !hasClaude) return
      if (next) { peak = next; rebuild() }
    } finally {
      peakBusy = false
    }
  }

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
      clearTimers()
      configEpoch++
      tz = next.tz
      summaryIntervalMs = next.summaryIntervalMs
      billingIntervalMs = next.billingIntervalMs
      const sourceKey = (r: ResolvedAccount) => `${r.account.providerId}:${r.account.homeDir ?? ''}`
      const prevSources = new Map(resolved.map(r => [r.account.id, sourceKey(r)]))
      resolved = next.resolved
      hasClaude = resolved.some(r => r.account.providerId === 'claude')
      if (!hasClaude) peak = null
      usageAccounts = resolved.filter(r => r.hasUsage)
      billingAccounts = resolved.filter(r => r.hasBilling)

      // Drop cached data for removed ids AND for ids whose account was repointed
      // at a different provider or home — otherwise the old source's numbers keep
      // rendering under the new identity until the next refresh completes.
      const survivors = new Set(
        resolved
          .filter(r => !prevSources.has(r.account.id) || prevSources.get(r.account.id) === sourceKey(r))
          .map(r => r.account.id),
      )
      for (const id of [...usage.keys()]) if (!survivors.has(id)) usage.delete(id)
      for (const id of [...billing.keys()]) if (!survivors.has(id)) billing.delete(id)
      for (const map of [summaryState, billingState, tableState]) {
        for (const id of [...map.keys()]) if (!survivors.has(id)) map.delete(id)
      }

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
