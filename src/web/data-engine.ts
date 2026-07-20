import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import type { DashboardData, TableData } from '../types'
import type { BillingResult } from '../providers/types'
import { cacheDir, snapshotCacheFile } from '../config'
import { withTimeout } from '../async'
import { fetchPeak } from '../peak'
import {
  assembleSnapshot, fetchAccountBilling, fetchAccountSummary, fetchAccountTable,
  type ResolvedAccount,
} from './data'
import type { WebSnapshot, AccountFetchState, PeakStatus } from './contract'
import type { Config } from '../config-schema'
import { createRefreshQueue, settleRefreshTasks, type RefreshQueue } from './refresh-queue'

const TABLE_INTERVAL_MS = 300_000
const PEAK_INTERVAL_MS = 300_000
const IDLE_PAUSE_MS = 60_000
const SNAPSHOT_CACHE_THROTTLE_MS = 20_000
const REVEAL_THROTTLE_MS = 500
const FETCH_TIMEOUT_MS = 30_000
export const DEFAULT_BILLING_STALE_MS = 5 * 60_000

export function billingNeedsCatchUp(
  accounts: readonly ResolvedAccount[],
  updatedAt: ReadonlyMap<string, number>,
  now = Date.now(),
  maxAgeMs = DEFAULT_BILLING_STALE_MS,
): boolean {
  return accounts.some(({ account }) => now - (updatedAt.get(account.id) ?? 0) >= maxAgeMs)
}

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
  refresh(scope?: RefreshScope): Promise<void>
  setConfig(next: { resolved: ResolvedAccount[]; tz: string; summaryIntervalMs: number; billingIntervalMs: number }): void
  broadcastConfig(config: Config): void
  stop(): void
}

export async function forEachProviderSequentially<T extends { account: { providerId: string } }>(
  values: readonly T[],
  task: (value: T) => Promise<void>,
): Promise<void> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const group = groups.get(value.account.providerId) ?? []
    group.push(value)
    groups.set(value.account.providerId, group)
  }
  await Promise.all([...groups.values()].map(async group => {
    for (const value of group) await task(value)
  }))
}

function runInBackground(task: Promise<void>): void {
  void task.catch(() => {})
}

export function throwIfRefreshFailures(scope: string, failures: readonly unknown[]): void {
  if (failures.length > 0) {
    throw new AggregateError(failures, `${scope} refresh failed for ${failures.length} account${failures.length === 1 ? '' : 's'}`)
  }
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
  const summaryUpdatedAt = new Map<string, number>()
  const billingUpdatedAt = new Map<string, number>()
  const tableUpdatedAt = new Map<string, number>()
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
    version, tz, intervalMs: summaryIntervalMs,
    billingIntervalMs, resolved, usage, billing,
    summaryState, billingState, tableState,
    summaryUpdatedAt, billingUpdatedAt, tableUpdatedAt, seeded, peak, config: currentConfig,
  })

  const hydrateFromCache = () => {
    try {
      const cached = JSON.parse(readFileSync(snapshotCacheFile(), 'utf-8')) as WebSnapshot
      if (!cached || !Array.isArray(cached.accounts)) return
      for (const a of cached.accounts) {
        if (a.dashboard || a.table) {
          const dashboard = a.dashboard
            ? {
                ...a.dashboard,
                lastActivityAt: typeof a.dashboard.lastActivityAt === 'number'
                  && Number.isSafeInteger(a.dashboard.lastActivityAt)
                  && a.dashboard.lastActivityAt >= 0
                  ? a.dashboard.lastActivityAt
                  : null,
              }
            : null
          usage.set(a.id, { dashboard, table: a.table })
          if (a.dashboard) {
            summaryState.set(a.id, 'ready')
            if (typeof a.summaryUpdatedAt === 'number') summaryUpdatedAt.set(a.id, a.summaryUpdatedAt)
          }
          if (a.table) {
            tableState.set(a.id, 'ready')
            if (typeof a.tableUpdatedAt === 'number') tableUpdatedAt.set(a.id, a.tableUpdatedAt)
          }
        }
        if (a.billing) {
          billing.set(a.id, a.billing)
          billingState.set(a.id, 'ready')
          if (typeof a.billingUpdatedAt === 'number') billingUpdatedAt.set(a.id, a.billingUpdatedAt)
        }
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

  // In-flight results are dropped when the config epoch moves; the queue then
  // reruns against the latest account set before forced waiters settle.
  const makeRefreshLoop = <T,>(opts: {
    scope: string
    accounts: () => ResolvedAccount[]
    fetch: (r: ResolvedAccount) => Promise<T>
    apply: (id: string, value: T) => void
    state: Map<string, AccountFetchState>
    updatedAt: Map<string, number>
    concurrent?: boolean | 'provider'
    forceWhileActive?: 'queue' | 'join'
  }): RefreshQueue => createRefreshQueue(
    async () => {
      if (stopped) return
      const epoch = configEpoch
      const fetchOne = async (r: ResolvedAccount) => {
        try {
          return { r, ok: true as const, value: await withTimeout(opts.fetch(r), FETCH_TIMEOUT_MS) }
        } catch (cause) {
          return { r, ok: false as const, cause }
        }
      }
      const failures: unknown[] = []
      const applyResult = (result: Awaited<ReturnType<typeof fetchOne>>) => {
        const id = result.r.account.id
        if (result.ok) {
          opts.apply(id, result.value)
          opts.state.set(id, 'ready')
          opts.updatedAt.set(id, Date.now())
        } else {
          opts.state.set(id, 'error')
          failures.push(result.cause)
        }
        reveal()
      }

      if (opts.concurrent === 'provider') {
        await forEachProviderSequentially(opts.accounts(), async r => {
          const result = await fetchOne(r)
          if (stopped || epoch !== configEpoch) return
          applyResult(result)
        })
        if (stopped || epoch !== configEpoch) return
      } else if (opts.concurrent) {
        await Promise.all(opts.accounts().map(async r => {
          const result = await fetchOne(r)
          if (stopped || epoch !== configEpoch) return
          applyResult(result)
        }))
        if (stopped || epoch !== configEpoch) return
      } else {
        for (const r of opts.accounts()) {
          if (stopped) return
          const result = await fetchOne(r)
          if (stopped || epoch !== configEpoch) return
          applyResult(result)
        }
      }
      rebuild()
      throwIfRefreshFailures(opts.scope, failures)
    },
    idle,
    { forceWhileActive: opts.forceWhileActive },
  )

  const refreshSummary = makeRefreshLoop({
    scope: 'summary',
    accounts: () => usageAccounts,
    fetch: r => fetchAccountSummary(r.account, tz),
    apply: (id, dashboard) => { usageEntry(id).dashboard = dashboard },
    state: summaryState,
    updatedAt: summaryUpdatedAt,
  })

  const refreshTable = makeRefreshLoop({
    scope: 'history',
    accounts: () => usageAccounts,
    fetch: r => fetchAccountTable(r.account, tz),
    apply: (id, table) => { usageEntry(id).table = table },
    state: tableState,
    updatedAt: tableUpdatedAt,
  })

  const refreshBilling = makeRefreshLoop({
    scope: 'billing',
    accounts: () => billingAccounts,
    fetch: r => fetchAccountBilling(r.account, tz),
    apply: (id, result) => { billing.set(id, result) },
    state: billingState,
    updatedAt: billingUpdatedAt,
    concurrent: 'provider',
    forceWhileActive: 'join',
  })

  const refreshBillingIfStale = (): Promise<void> =>
    billingNeedsCatchUp(billingAccounts, billingUpdatedAt, Date.now(), billingIntervalMs)
      ? refreshBilling.run(true)
      : Promise.resolve()

  const refreshPeak = createRefreshQueue(
    async () => {
      if (stopped || !hasClaude) return
      const epoch = configEpoch
      const next = await fetchPeak()
      if (stopped || epoch !== configEpoch || !hasClaude) return
      if (next) { peak = next; rebuild() }
    },
    () => !hasClaude || idle(),
  )

  const clearTimers = () => {
    clearInterval(summaryTimer); summaryTimer = undefined
    clearInterval(tableTimer); tableTimer = undefined
    clearInterval(billingTimer); billingTimer = undefined
    clearInterval(peakTimer); peakTimer = undefined
  }

  const startTimers = () => {
    summaryTimer = setInterval(() => { runInBackground(refreshSummary.run()) }, summaryIntervalMs)
    tableTimer = setInterval(() => { runInBackground(refreshTable.run()) }, TABLE_INTERVAL_MS)
    billingTimer = setInterval(() => { runInBackground(refreshBilling.run()) }, billingIntervalMs)
    summaryTimer.unref?.()
    tableTimer.unref?.()
    billingTimer.unref?.()
    if (hasClaude) {
      peakTimer = setInterval(() => { runInBackground(refreshPeak.run()) }, PEAK_INTERVAL_MS)
      peakTimer.unref?.()
    }
  }

  hydrateFromCache()

  return {
    snapshot: () => current,

    start() {
      runInBackground(refreshSummary.run(true))
      runInBackground(refreshTable.run(true))
      runInBackground(refreshBilling.run(true))
      if (hasClaude) runInBackground(refreshPeak.run(true))
      startTimers()
    },

    touch() { lastActivity = Date.now() },

    refresh(scope = 'all') {
      if (stopped) return Promise.resolve()
      const tasks: Promise<void>[] = []
      if (scope === 'all' || scope === 'summary') tasks.push(refreshSummary.run(true))
      if (scope === 'all' || scope === 'table') tasks.push(refreshTable.run(true))
      // Explicit refreshes are user intent. Focus/viewer attachment uses the
      // freshness gate above, while R/CLI --refresh may deliberately re-query.
      if (scope === 'all' || scope === 'billing') tasks.push(refreshBilling.run(true))
      if ((scope === 'all' || scope === 'peak') && hasClaude) tasks.push(refreshPeak.run(true))
      return settleRefreshTasks(tasks)
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
      for (const map of [summaryUpdatedAt, billingUpdatedAt, tableUpdatedAt]) {
        for (const id of [...map.keys()]) if (!survivors.has(id)) map.delete(id)
      }

      rebuild()
      runInBackground(refreshSummary.run(true))
      runInBackground(refreshTable.run(true))
      runInBackground(refreshBillingIfStale())
      if (hasClaude) runInBackground(refreshPeak.run(true))
      startTimers()
    },

    broadcastConfig(config) {
      if (stopped) return
      currentConfig = config
      rebuild()
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
        runInBackground(refreshSummary.run(true))
        runInBackground(refreshTable.run(true))
      }
      runInBackground(refreshBillingIfStale())
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
      refreshSummary.stop()
      refreshTable.stop()
      refreshBilling.stop()
      refreshPeak.stop()
      snapshotSubscribers.clear()
      configSubscribers.clear()
    },
  }
}
