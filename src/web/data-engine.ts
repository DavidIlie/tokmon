import type { ServerResponse } from 'node:http'
import type { DashboardData, TableData } from '../types'
import type { BillingResult } from '../providers/types'
import {
  assembleSnapshot, fetchAccountBilling, fetchAccountSummary, fetchAccountTable,
  type ResolvedAccount,
} from './data'
import type { WebSnapshot } from './contract'

const TABLE_INTERVAL_MS = 300_000
const SSE_HEARTBEAT_MS = 25_000
// Skip refreshes when no SSE clients and idle — keeps CPU near-zero.
const IDLE_PAUSE_MS = 60_000

interface DataEngineOptions {
  version: string
  tz: string
  summaryIntervalMs: number
  billingIntervalMs: number
  resolved: ResolvedAccount[]
}

export interface DataEngine {
  snapshot(): WebSnapshot | null
  /** Fire the initial forced fetches and start the periodic timers. */
  start(): void
  /** Register an SSE response; returns a cleanup function. */
  addSseClient(res: ServerResponse): () => void
  /** Touch the activity timestamp (on /api/data and /api/stream). */
  touch(): void
  /** Cancel in-flight refreshes, clear timers, drain SSE clients. */
  stop(): void
}

export function createDataEngine(opts: DataEngineOptions): DataEngine {
  const { version, tz, summaryIntervalMs, billingIntervalMs, resolved } = opts

  const usage = new Map<string, { dashboard: DashboardData | null; table: TableData | null }>()
  const billing = new Map<string, BillingResult | null>()
  let current: WebSnapshot | null = null
  const sseClients = new Map<ServerResponse, ReturnType<typeof setInterval>>()
  let lastActivity = Date.now()
  let stopped = false
  let summaryTimer: ReturnType<typeof setInterval> | undefined
  let tableTimer: ReturnType<typeof setInterval> | undefined
  let billingTimer: ReturnType<typeof setInterval> | undefined

  const idle = () => sseClients.size === 0 && Date.now() - lastActivity > IDLE_PAUSE_MS

  const usageEntry = (id: string) => {
    let u = usage.get(id)
    if (!u) { u = { dashboard: null, table: null }; usage.set(id, u) }
    return u
  }

  const rebuild = () => {
    if (stopped) return
    current = assembleSnapshot({ version, tz, intervalMs: summaryIntervalMs, resolved, usage, billing })
    if (sseClients.size === 0) return
    const payload = `event: snapshot\ndata: ${JSON.stringify(current)}\n\n`
    for (const res of sseClients.keys()) {
      try { res.write(payload) } catch {}
    }
  }

  const usageAccounts = resolved.filter(r => r.hasUsage)
  const billingAccounts = resolved.filter(r => r.hasBilling)

  let summaryBusy = false
  const refreshSummary = async (force = false) => {
    if (stopped || summaryBusy || (!force && idle())) return
    summaryBusy = true
    try {
      // Serialized so peak CPU stays ~1 core.
      for (const r of usageAccounts) {
        if (stopped) return
        usageEntry(r.account.id).dashboard = await fetchAccountSummary(r.account, tz)
      }
      rebuild()
    } finally {
      summaryBusy = false
    }
  }

  let tableBusy = false
  const refreshTable = async (force = false) => {
    if (stopped || tableBusy || (!force && idle())) return
    tableBusy = true
    try {
      for (const r of usageAccounts) {
        if (stopped) return
        usageEntry(r.account.id).table = await fetchAccountTable(r.account, tz)
      }
      rebuild()
    } finally {
      tableBusy = false
    }
  }

  let billingBusy = false
  const refreshBilling = async (force = false) => {
    if (stopped || billingBusy || (!force && idle())) return
    billingBusy = true
    try {
      for (const r of billingAccounts) {
        if (stopped) return
        billing.set(r.account.id, await fetchAccountBilling(r.account))
      }
      rebuild()
    } finally {
      billingBusy = false
    }
  }

  return {
    snapshot: () => current,

    start() {
      void refreshSummary(true)
      void refreshTable(true)
      void refreshBilling(true)
      summaryTimer = setInterval(() => { void refreshSummary() }, summaryIntervalMs)
      tableTimer = setInterval(() => { void refreshTable() }, TABLE_INTERVAL_MS)
      billingTimer = setInterval(() => { void refreshBilling() }, billingIntervalMs)
      summaryTimer.unref?.()
      tableTimer.unref?.()
      billingTimer.unref?.()
    },

    touch() { lastActivity = Date.now() },

    addSseClient(res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })
      res.write('retry: 3000\n\n')
      if (current) res.write(`event: snapshot\ndata: ${JSON.stringify(current)}\n\n`)
      const beat = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, SSE_HEARTBEAT_MS)
      beat.unref?.()
      sseClients.set(res, beat)
      lastActivity = Date.now()
      // A viewer arrived — force-refresh so charts have data on first paint / after idle.
      if (!current || Date.now() - current.generatedAt > summaryIntervalMs) {
        void refreshSummary(true)
        void refreshTable(true)
      }
      return () => { clearInterval(beat); sseClients.delete(res) }
    },

    stop() {
      stopped = true // halt in-flight refreshes between accounts / before rebuild
      clearInterval(summaryTimer)
      clearInterval(tableTimer)
      clearInterval(billingTimer)
      for (const [res, beat] of sseClients) { clearInterval(beat); try { res.end() } catch {} }
      sseClients.clear()
    },
  }
}
