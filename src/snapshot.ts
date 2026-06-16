import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { cacheDir } from './config'
import type { DashboardData } from './types'
import type { BillingResult } from './providers/types'
import type { AccountStats } from './stats'

type Snapshot = Record<string, { dashboard: DashboardData | null; billing: BillingResult | null }>

function snapshotFile(): string {
  return join(cacheDir(), 'dashboard-snapshot.json')
}

export async function loadSnapshot(): Promise<Snapshot> {
  try {
    const obj = JSON.parse(await readFile(snapshotFile(), 'utf-8'))
    return obj && typeof obj === 'object' ? obj as Snapshot : {}
  } catch {
    return {}
  }
}

let saveQueue: Promise<void> = Promise.resolve()

export function saveSnapshot(stats: Map<string, AccountStats>): void {
  const obj: Snapshot = {}
  for (const [id, s] of stats) {
    if (s.dashboard || s.billing) obj[id] = { dashboard: s.dashboard ?? null, billing: s.billing ?? null }
  }
  saveQueue = saveQueue.then(async () => {
    try {
      const dir = cacheDir()
      await mkdir(dir, { recursive: true })
      const tmp = join(dir, `dashboard-snapshot.json.${process.pid}.tmp`)
      await writeFile(tmp, JSON.stringify(obj))
      await rename(tmp, snapshotFile())
    } catch {}
  })
}
