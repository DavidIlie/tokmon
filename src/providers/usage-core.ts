import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { UsageSummary, TableRow, ModelDetail, DashboardData, TableData } from '../types'
import { dayKey, monthKey, weekKey, startOfDay, startOfMonth, startOfWeek } from '../tz'
import { cacheDir } from '../config'

/** Days of daily-cost history kept for the dashboard sparkline. */
export const SPARK_DAYS = 14
const DAY_MS = 86_400_000

/**
 * One normalized usage record. Providers parse their own log formats into
 * Entry[]; everything downstream (summaries, tables, burn rate) is shared so
 * Claude and Codex render through the exact same pipeline.
 *
 * `model` is already the short display name. `id` is a stable dedup key when one
 * exists (Claude message id — Claude logs the same message's usage repeatedly);
 * omit it for records that are unique by value (Codex turns), which fall back to
 * a value-tuple dedup.
 */
export interface Entry {
  ts: number
  id?: string
  model: string
  cost: number
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  /** What cache reads saved vs paying full input rate: cacheRead·(in − cacheRead rate). */
  cacheSavings: number
}

// ---- Persistent parse cache ------------------------------------------------
// Parsing every Claude/Codex log on each launch is the dominant cost (Codex
// cold ≈ 10s). We cache each file's fully-parsed Entry[] keyed by path+mtime to
// disk, so a relaunch only re-parses files that actually changed. Only stable
// (immutable) files are persisted — today's still-being-written files re-parse
// cheaply and would otherwise churn the cache file every poll.

const CACHE_VERSION = 4
const STABLE_AGE_MS = 5 * 60_000
const PRUNE_AGE_MS = 200 * DAY_MS   // drop files older than any view needs (table = 6mo)
const memCache = new Map<string, { mtimeMs: number; size: number; entries: Entry[] }>()
let diskLoaded = false
let dirty = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** Compact per-file shard: mtime + size (invalidation), model dictionary + rows. */
type Shard = { m: number; s: number; mods: string[]; rows: (number | string)[][] }

function cacheFile(): string {
  return join(cacheDir(), `usage-v${CACHE_VERSION}.json`)
}

function encode(mtimeMs: number, size: number, entries: Entry[]): Shard {
  const mods: string[] = []
  const idx = new Map<string, number>()
  const rows = entries.map(e => {
    let mi = idx.get(e.model)
    if (mi === undefined) { mi = mods.length; mods.push(e.model); idx.set(e.model, mi) }
    // trailing slot is the dedup id (string) or 0 when value-tuple deduped (Codex)
    return [e.ts, mi, e.input, e.output, e.cacheCreate, e.cacheRead, e.cost, e.cacheSavings, e.id ?? 0]
  })
  return { m: mtimeMs, s: size, mods, rows }
}

function decode(s: Shard): Entry[] {
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
  const out: Entry[] = []
  for (const r of s.rows) {
    if (!Array.isArray(r) || r.length < 8) continue           // skip malformed/old rows
    const ts = r[0]
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue
    const mi = r[1]
    out.push({
      ts,
      model: typeof mi === 'number' && typeof s.mods[mi] === 'string' ? s.mods[mi] : 'unknown',
      input: num(r[2]), output: num(r[3]), cacheCreate: num(r[4]), cacheRead: num(r[5]),
      cost: num(r[6]), cacheSavings: num(r[7]),
      id: typeof r[8] === 'string' ? r[8] : undefined,
    })
  }
  return out
}

async function ensureDiskLoaded(): Promise<void> {
  if (diskLoaded) return
  diskLoaded = true
  try {
    const obj = JSON.parse(await readFile(cacheFile(), 'utf-8')) as Record<string, Shard>
    for (const [path, s] of Object.entries(obj)) {
      if (s && typeof s.m === 'number' && Array.isArray(s.rows) && Array.isArray(s.mods)) {
        memCache.set(path, { mtimeMs: s.m, size: typeof s.s === 'number' ? s.s : -1, entries: decode(s) })
      }
    }
  } catch { /* missing or corrupt cache → rebuild from scratch */ }
}

export async function flushDisk(): Promise<void> {
  if (!dirty) return
  const now = Date.now()
  const obj: Record<string, Shard> = {}
  for (const [path, v] of memCache) {
    // Persist only stable (immutable) files within the window any view needs.
    if (now - v.mtimeMs > STABLE_AGE_MS && now - v.mtimeMs < PRUNE_AGE_MS) {
      obj[path] = encode(v.mtimeMs, v.size, v.entries)
    }
  }
  try {
    await mkdir(cacheDir(), { recursive: true })
    const tmp = `${cacheFile()}.${process.pid}.tmp`   // per-process temp avoids concurrent clobber
    await writeFile(tmp, JSON.stringify(obj))
    await rename(tmp, cacheFile())                     // atomic publish
    dirty = false                                      // clear only after a successful write (retry on failure)
  } catch { /* best-effort; cache is an optimization only */ }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; void flushDisk() }, 4000)
  flushTimer.unref?.()
}

/**
 * Load entries from a set of files, using the persistent cache. `parse` must
 * return ALL entries in a file (no time filtering) so one cache entry serves
 * every window; results are filtered to `since` here and de-duplicated.
 */
/** Run `fn` over items with at most `limit` in flight (bounds FDs/CPU on cold load). */
async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  const worker = async () => { while (i < items.length) await fn(items[i++]) }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export async function loadCachedEntries(
  files: { path: string; mtimeMs: number; size: number }[],
  parse: (path: string) => Promise<Entry[]>,
  since: number,
): Promise<Entry[]> {
  await ensureDiskLoaded()
  const chunks: Entry[][] = []
  await mapLimit(files, 8, async (f) => {
    try {
      let c = memCache.get(f.path)
      // Re-parse when EITHER mtime or size changed (append-only logs move both;
      // size also catches a rare same-mtime edit — far cheaper than hashing bytes).
      if (!c || c.mtimeMs !== f.mtimeMs || c.size !== f.size) {
        const entries = await parse(f.path)
        c = { mtimeMs: f.mtimeMs, size: f.size, entries }
        memCache.set(f.path, c)
        if (Date.now() - f.mtimeMs > STABLE_AGE_MS) dirty = true
      }
      chunks.push(c.entries)
    } catch { /* file vanished / rotated / locked mid-read — skip, don't fail the load */ }
  })
  if (dirty) scheduleFlush()
  return dedupe(chunks.flat().filter(e => e.ts >= since))
}

/**
 * Drop duplicates that arise when the same turn/message appears in multiple
 * files (Claude resumed sessions, Codex branched rollouts). Keyed on the full
 * value tuple — two identical events at the same millisecond are the same event.
 */
/** Coerce an untrusted log field to a safe non-negative integer token count.
 * Requires an actual number — numeric strings like "1e6"/"0x10" are rejected. */
export function safeNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

export function dedupe(entries: Entry[]): Entry[] {
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const e of entries) {
    const k = e.id ?? `${e.ts} ${e.model} ${e.input} ${e.output} ${e.cacheCreate} ${e.cacheRead}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

export function summarize(entries: Entry[], tz: string): DashboardData {
  const now = Date.now()
  const todayStart = startOfDay(now, tz)
  const weekStart = startOfWeek(now, tz)
  const monthStart = startOfMonth(now, tz)

  const today: UsageSummary = { cost: 0, tokens: 0, cacheRead: 0, cacheSavings: 0 }
  const week: UsageSummary = { cost: 0, tokens: 0, cacheRead: 0, cacheSavings: 0 }
  const month: UsageSummary = { cost: 0, tokens: 0, cacheRead: 0, cacheSavings: 0 }
  const byDay = new Map<string, number>()
  let oldestToday = now
  let hadToday = false

  // Single pass: accumulate the three windows, the daily series, and burn-rate
  // inputs at once (one dayKey() per entry instead of three filters + two keys).
  const add = (s: UsageSummary, e: Entry) => {
    s.cost += e.cost
    s.tokens += e.input + e.output + e.cacheCreate + e.cacheRead
    s.cacheRead += e.cacheRead
    s.cacheSavings += e.cacheSavings
  }
  for (const e of entries) {
    if (e.ts >= monthStart) add(month, e)
    if (e.ts >= weekStart) add(week, e)
    if (e.ts >= todayStart) { add(today, e); hadToday = true; if (e.ts < oldestToday) oldestToday = e.ts }
    const dk = dayKey(e.ts, tz)
    byDay.set(dk, (byDay.get(dk) ?? 0) + e.cost)
  }

  // Clamp the span to ≥1 min so a single recent event can't show a wild $/hr.
  const hrs = Math.max((now - oldestToday) / 3_600_000, 1 / 60)
  const burnRate = hadToday ? today.cost / hrs : 0

  const series: number[] = []
  for (let i = SPARK_DAYS - 1; i >= 0; i--) series.push(byDay.get(dayKey(now - i * DAY_MS, tz)) ?? 0)

  return { today, week, month, burnRate, series }
}

function groupBy(entries: Entry[], keyFn: (e: Entry) => string): TableRow[] {
  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    const key = keyFn(e)
    const arr = groups.get(key)
    if (arr) arr.push(e)
    else groups.set(key, [e])
  }

  const rows: TableRow[] = []
  for (const [label, group] of groups) {
    let input = 0, output = 0, cacheCreate = 0, cacheRead = 0, cost = 0
    const byModel = new Map<string, ModelDetail>()

    for (const e of group) {
      input += e.input
      output += e.output
      cacheCreate += e.cacheCreate
      cacheRead += e.cacheRead
      cost += e.cost

      const m = byModel.get(e.model)
      if (m) {
        m.input += e.input; m.output += e.output
        m.cacheCreate += e.cacheCreate; m.cacheRead += e.cacheRead
        m.cost += e.cost
      } else {
        byModel.set(e.model, {
          name: e.model, input: e.input, output: e.output,
          cacheCreate: e.cacheCreate, cacheRead: e.cacheRead, cost: e.cost,
        })
      }
    }

    rows.push({
      label, models: [...byModel.keys()].sort(),
      input, output, cacheCreate, cacheRead,
      total: input + output + cacheCreate + cacheRead, cost,
      breakdown: [...byModel.values()].sort((a, b) => b.cost - a.cost),
    })
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label))
}

export function tabulate(entries: Entry[], tz: string): TableData {
  return {
    daily: groupBy(entries, e => dayKey(e.ts, tz)),
    weekly: groupBy(entries, e => weekKey(e.ts, tz)),
    monthly: groupBy(entries, e => monthKey(e.ts, tz)),
  }
}

function mergeRows(groups: TableRow[][]): TableRow[] {
  const byLabel = new Map<string, TableRow>()
  for (const rows of groups) {
    for (const r of rows) {
      const ex = byLabel.get(r.label)
      if (!ex) {
        byLabel.set(r.label, { ...r, models: [...r.models], breakdown: r.breakdown.map(m => ({ ...m })) })
        continue
      }
      ex.input += r.input; ex.output += r.output; ex.cacheCreate += r.cacheCreate
      ex.cacheRead += r.cacheRead; ex.total += r.total; ex.cost += r.cost
      const bd = new Map(ex.breakdown.map(m => [m.name, m]))
      for (const m of r.breakdown) {
        const e = bd.get(m.name)
        if (e) {
          e.input += m.input; e.output += m.output
          e.cacheCreate += m.cacheCreate; e.cacheRead += m.cacheRead; e.cost += m.cost
        } else {
          bd.set(m.name, { ...m })
        }
      }
      ex.breakdown = [...bd.values()].sort((a, b) => b.cost - a.cost)
      ex.models = [...bd.keys()].sort()
    }
  }
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** Combine multiple accounts' tables into one (for the "All" scope). */
export function mergeTables(list: TableData[]): TableData {
  return {
    daily: mergeRows(list.map(t => t.daily)),
    weekly: mergeRows(list.map(t => t.weekly)),
    monthly: mergeRows(list.map(t => t.monthly)),
  }
}
