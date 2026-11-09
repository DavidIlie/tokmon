import { Worker } from 'node:worker_threads'
import { PROVIDERS } from '../providers'
import { flushDisk, invalidateSessionScans } from '../providers/usage-core'
import type { Account } from '../providers/types'
import type { DashboardData, TableData } from '../types'

export type UsageWorkerRequest =
  | { id: number; kind: 'summary' | 'table'; account: Account; tz: string }
  | { id: number; kind: 'invalidate' | 'flush' }

export type UsageWorkerResponse =
  | { ready: true }
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }

const READY_TIMEOUT_MS = 10_000
/** A worker that keeps dying is not coming back; stop paying for restarts. */
const MAX_STARTS = 3

type Pending = { resolve: (value: unknown) => void; reject: (cause: Error) => void }

let worker: Worker | null = null
let ready: Promise<boolean> | null = null
let starts = 0
let nextId = 1
const pending = new Map<number, Pending>()
// The worker is an optimisation of where the work runs, never a requirement:
// if it cannot load (an unusual packaging, a disabled runtime feature), usage
// collection carries on in this thread exactly as it did before.
let inline = process.env.TOKMON_USAGE_WORKER === '0'

function failPending(cause: Error): void {
  for (const waiter of pending.values()) waiter.reject(cause)
  pending.clear()
}

function start(): Promise<boolean> {
  if (inline) return Promise.resolve(false)
  if (ready) return ready
  if (starts >= MAX_STARTS) {
    inline = true
    return Promise.resolve(false)
  }
  starts++
  ready = new Promise<boolean>(resolve => {
    let settled = false
    const settle = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!ok) {
        inline = true
        console.error('[tokmon] usage worker unavailable; collecting usage on the main thread')
      }
      resolve(ok)
    }
    const timer = setTimeout(() => settle(false), READY_TIMEOUT_MS)
    timer.unref?.()
    try {
      // Bundled, the worker is emitted beside the chunk that contains this file.
      const file = import.meta.url.endsWith('.ts') ? './usage-worker.ts' : './usage-worker.js'
      const created = new Worker(new URL(file, import.meta.url))
      worker = created
      created.on('message', (message: UsageWorkerResponse) => {
        if ('ready' in message) {
          // An idle worker must never be what keeps a finished process alive;
          // it is referenced again for as long as a request is in flight.
          created.unref()
          settle(true)
          return
        }
        const waiter = pending.get(message.id)
        if (!waiter) return
        pending.delete(message.id)
        if (pending.size === 0) created.unref()
        if (message.ok) waiter.resolve(message.value)
        else waiter.reject(new Error(message.error))
      })
      const gone = (cause: Error) => {
        if (worker !== created) return
        worker = null
        // Before it ever answered, the worker cannot run here at all. After
        // that, a crash gets a bounded number of fresh starts.
        if (!settled) settle(false)
        else ready = null
        failPending(cause)
      }
      created.on('error', error => gone(error instanceof Error ? error : new Error(String(error))))
      created.on('exit', code => gone(new Error(`usage worker exited with code ${code}`)))
    } catch {
      settle(false)
    }
  })
  return ready
}

async function call<T>(request: UsageWorkerRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never, fallback: () => Promise<T>): Promise<T> {
  if (!(await start()) || !worker) return fallback()
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    worker!.ref()
    worker!.postMessage({ ...request, id })
  })
}

export function collectSummary(account: Account, tz: string): Promise<DashboardData | null> {
  return call({ kind: 'summary', account, tz }, async () => await PROVIDERS[account.providerId].fetchSummary?.(account, tz) ?? null)
}

export function collectTable(account: Account, tz: string): Promise<TableData | null> {
  return call({ kind: 'table', account, tz }, async () => await PROVIDERS[account.providerId].fetchTable?.(account, tz) ?? null)
}

/** Makes the next collection walk every log directory again. */
export function invalidateUsageScans(): void {
  void call({ kind: 'invalidate' }, async () => { invalidateSessionScans() }).catch(() => {})
}

/** Writes pending parsed-log shards and releases the worker. */
export async function stopUsageCollection(): Promise<void> {
  const active = worker
  await call({ kind: 'flush' }, flushDisk).catch(() => {})
  if (active && worker === active) {
    worker = null
    ready = null
    starts = 0
    await active.terminate().catch(() => {})
  }
}
