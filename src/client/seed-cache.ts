// NODE-ONLY. Read-only seed for the DEGRADED in-process path.
//
// The daemon is the SOLE writer of cacheDir()/web-snapshot.json (the rich
// EngineSnapshot cache). When the TUI runs degraded (no daemon could be
// spawned), it has no live data yet, so it seeds its in-process stats from
// whatever a PRIOR connected session persisted — read-only, never written here.
// This replaces the deleted src/snapshot.ts (dashboard-snapshot.json), which
// was the second cache writer; there is now exactly one writer (the daemon).

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cacheDir } from '../config'
import type { DashboardData } from '../types'
import type { BillingResult } from '../providers/types'
import type { WebSnapshot } from '../web/contract'

export type SeedSnapshot = Record<string, { dashboard: DashboardData | null; billing: BillingResult | null }>

const snapshotCacheFile = (): string => join(cacheDir(), 'web-snapshot.json')

// Project the daemon's web-snapshot.json into the {dashboard, billing} shape the
// degraded seed needs (keyed by account id). Returns {} on any read/parse error
// or when no cache exists yet.
export async function loadSeedSnapshot(): Promise<SeedSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(snapshotCacheFile(), 'utf-8')) as WebSnapshot
    if (!parsed || !Array.isArray(parsed.accounts)) return {}
    const out: SeedSnapshot = {}
    for (const a of parsed.accounts) {
      if (a.dashboard || a.billing) out[a.id] = { dashboard: a.dashboard ?? null, billing: a.billing ?? null }
    }
    return out
  } catch {
    return {}
  }
}
