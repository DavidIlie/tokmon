import { readFile } from 'node:fs/promises'
import { snapshotCacheFile } from '../config'
import type { DashboardData } from '../types'
import type { BillingResult } from '../providers/types'
import { decodeWebSnapshot } from '../web/snapshot-schema'

export type SeedSnapshot = Record<string, { dashboard: DashboardData | null; billing: BillingResult | null }>

export async function loadSeedSnapshot(): Promise<SeedSnapshot> {
  try {
    const parsed = decodeWebSnapshot(JSON.parse(await readFile(snapshotCacheFile(), 'utf-8')))
    if (!parsed) return {}
    const out: SeedSnapshot = {}
    for (const a of parsed.accounts) {
      if (a.dashboard || a.billing) out[a.id] = { dashboard: a.dashboard ?? null, billing: a.billing ?? null }
    }
    return out
  } catch {
    return {}
  }
}
