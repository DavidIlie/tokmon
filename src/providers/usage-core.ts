import type { Dirent } from 'node:fs'
import { readFileSync, readdirSync } from 'node:fs'
import { readdir, stat as fsStat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { UsageSummary, TableRow, ModelDetail, DashboardData, TableData } from '../types'
import { dayKey, monthKey, weekKey, startOfDay, startOfMonth, startOfWeek } from '../tz'
import { cacheDir } from '../config'
import { finitePositive, safeNum } from './_shared/metric'
import { UsageShardStore, type UsageCacheFingerprint, type UsageParseResult } from './storage/usage-shard-store'

export { finitePositive, safeNum } from './_shared/metric'

// Keep enough daily points for every UI range. Renderers select their desired
// trailing window without forcing the daemon to refetch provider history.
export const SPARK_DAYS = 30
const DAY_MS = 86_400_000

export interface Entry {
  ts: number
  id?: string
  model: string
  /** Requests represented by this entry; defaults to 1 in groupBy. */
  count?: number
  cost: number
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  cacheSavings: number
}

// Cache eviction only affects derived shards. Source logs remain authoritative
// and are reparsed when an old shard is absent.
const PRUNE_AGE_MS = 230 * DAY_MS
type Shard = { mods: string[]; rows: (number | string)[][] }
const stores = new Map<string, UsageShardStore<Entry>>()
const MAX_STORES = 6
// Results of the last few dashboard loads, keyed by the exact set of source
// revisions. A poll that finds no log changed returns the same rows without
// touching the shard store.
const loadMemo = new Map<string, Entry[]>()
const MAX_LOAD_MEMO = 16

/**
 * Parser and pricing fingerprints are part of a shard's identity.  Callers
 * with an externally configurable parser/pricing table can supply stable,
 * explicit versions; existing providers get a source-derived default.
 */
export interface UsageCacheOptions<State = unknown> {
  fingerprint?: Partial<UsageCacheFingerprint>
  /** Primarily useful for isolated embedders; normal providers use cacheDir(). */
  storageDir?: string
  /**
   * For append-only logs whose rows parse independently of earlier lines:
   * parses the bytes in [start, end). A grown file then costs only its new
   * bytes instead of a full reparse.
   */
  parseRange?: (path: string, start: number, end: number) => Promise<Entry[]>
  /** Reads [start, end), restoring and returning carry state for stateful logs. */
  parseResume?: (path: string, start: number, end: number, state?: State) => Promise<UsageParseResult<Entry, State>>
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function runningBuildFingerprint(): string {
  // A bundled release contains the provider parsers and pricing tables.  This
  // catches a pricing-only change in an imported module, which parse.toString()
  // alone cannot see.  Explicit caller fingerprints still take precedence.
  try {
    const modulePath = fileURLToPath(import.meta.url)
    if (modulePath.endsWith('.ts')) {
      const root = dirname(modulePath)
      const files: string[] = []
      const stack = [root]
      while (stack.length > 0) {
        const dir = stack.pop()!
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) stack.push(path)
          else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.')) files.push(path)
        }
      }
      const sourceHash = createHash('sha256')
      for (const path of files.sort()) {
        sourceHash.update(relative(root, path)).update('\0').update(readFileSync(path)).update('\0')
      }
      return `source-tree-${sourceHash.digest('hex').slice(0, 24)}`
    }
    const entrypoint = process.argv[1]
    if (!entrypoint) return 'build-unknown'
    const bytes = readFileSync(entrypoint)
    if (bytes.byteLength > 8 * 1024 * 1024) return 'build-unknown'
    return `build-${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}`
  } catch {
    return 'build-unknown'
  }
}

const RUNNING_BUILD_FINGERPRINT = runningBuildFingerprint()

function fingerprintFor<State>(parse: (path: string) => Promise<Entry[]>, options?: UsageCacheOptions<State>): UsageCacheFingerprint {
  // This is deliberately a fingerprint rather than a manually bumped global
  // cache number.  A provider can override either dimension when its parser or
  // pricing data is generated/configured outside this function's source.
  const sourceVersion = `source-${hash([parse, options?.parseRange, options?.parseResume]
    .filter(fn => fn !== undefined).map(fn => Function.prototype.toString.call(fn)).join('\0'))}`
  return {
    format: options?.fingerprint?.format ?? 'usage-shard-v2',
    parser: options?.fingerprint?.parser ?? `${sourceVersion}.${RUNNING_BUILD_FINGERPRINT}`,
    pricing: options?.fingerprint?.pricing ?? RUNNING_BUILD_FINGERPRINT,
  }
}

function encode(entries: Entry[]): Shard {
  const mods: string[] = []
  const idx = new Map<string, number>()
  const rows = entries.map(e => {
    let mi = idx.get(e.model)
    if (mi === undefined) { mi = mods.length; mods.push(e.model); idx.set(e.model, mi) }
    return [e.ts, mi, e.input, e.output, e.cacheCreate, e.cacheRead, e.cost, e.cacheSavings, e.id ?? 0, e.count ?? 1]
  })
  return { mods, rows }
}

function decode(value: unknown): Entry[] | null {
  const s = value as Partial<Shard> | null
  if (!s || !Array.isArray(s.rows) || !Array.isArray(s.mods)) return null
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
  const out: Entry[] = []
  for (const r of s.rows) {
    if (!Array.isArray(r) || r.length < 8) continue
    const ts = r[0]
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue
    const mi = r[1]
    out.push({
      ts,
      model: typeof mi === 'number' && typeof s.mods[mi] === 'string' ? s.mods[mi] : 'unknown',
      input: num(r[2]), output: num(r[3]), cacheCreate: num(r[4]), cacheRead: num(r[5]),
      cost: num(r[6]), cacheSavings: num(r[7]),
      id: typeof r[8] === 'string' ? r[8] : undefined,
      count: num(r[9]) || 1,
    })
  }
  return out
}

function storeFor<State>(parse: (path: string) => Promise<Entry[]>, options?: UsageCacheOptions<State>): { store: UsageShardStore<Entry>; key: string } {
  const dir = options?.storageDir ?? cacheDir()
  const fingerprint = fingerprintFor(parse, options)
  const key = `${dir}\0${fingerprint.format}\0${fingerprint.parser}\0${fingerprint.pricing}`
  let store = stores.get(key)
  if (store) {
    // Keep the registry itself bounded as well as each shard store's LRU.
    stores.delete(key)
    stores.set(key, store)
  } else {
    if (stores.size >= MAX_STORES) stores.delete(stores.keys().next().value as string)
    store = new UsageShardStore<Entry>({
      dir,
      fingerprint,
      // Several providers can be active at once; each gets a bounded small LRU
      // instead of retaining every decoded log in one process-global map.
      // The limits must cover a provider's whole active window: a smaller LRU
      // evicts shards that the very next poll reads back from disk.
      maxMemoryBytes: 24 * 1024 * 1024,
      maxMemoryShards: 8192,
      staleAfterMs: PRUNE_AGE_MS,
      encode,
      decode,
    })
    stores.set(key, store)
  }
  return { store, key }
}

export async function flushDisk(): Promise<void> {
  await Promise.all([...stores.values()].map(store => store.flush()))
}

export async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const stack = ['']
  while (stack.length > 0) {
    const rel = stack.pop() ?? ''
    const dir = rel ? join(root, rel) : root
    let entries: Dirent<string>[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const child = rel ? join(rel, entry.name) : entry.name
      if (entry.isDirectory()) stack.push(child)
      else if (entry.isFile()) files.push(child)
    }
  }
  return files
}

/**
 * Existence-only counterpart to walkFiles: stops at the first match instead of
 * collecting the whole tree. Detection asks "is there any session file here?"
 * on trees that can hold thousands of files, so the answer must not cost a
 * full traversal. Symlinks are neither files nor directories under
 * withFileTypes, so they are skipped and cannot form a loop.
 */
export async function hasFileMatching(
  root: string,
  predicate: (path: string) => boolean,
  options?: { maxDirs?: number },
): Promise<boolean> {
  const stack = [root]
  let visitedDirs = 0
  const maxDirs = options?.maxDirs ?? Number.POSITIVE_INFINITY
  while (stack.length > 0 && visitedDirs < maxDirs) {
    const dir = stack.pop()!
    let entries: Dirent<string>[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    visitedDirs++
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isFile()) { if (predicate(path)) return true }
      else if (entry.isDirectory()) stack.push(path)
    }
  }
  return false
}

type SessionFile = { path: string; mtimeMs: number; size: number }

// Walking and stat-ing a whole history every poll scales with how long someone
// has used a tool, not with what changed. Between full walks only files written
// recently are re-checked: that is where an append lands. A log that resumes
// after a long pause, or a brand-new one, is picked up by the next full walk.
const FULL_SCAN_EVERY_MS = 15_000
const HOT_FILE_WINDOW_MS = 10 * 60_000
const MAX_SCANS = 16
const scans = new Map<string, { fullAt: number; files: Map<string, SessionFile> }>()

/** Makes the next collectSessionFiles call for every root walk the tree again. */
export function invalidateSessionScans(): void {
  scans.clear()
}

async function scanSessionFiles(
  roots: readonly string[],
  predicate: (path: string) => boolean,
): Promise<Map<string, SessionFile>> {
  const files = new Map<string, SessionFile>()
  const seenIno = new Set<string>()
  for (const root of roots) {
    for (const relativePath of await walkFiles(root)) {
      if (!predicate(relativePath)) continue
      const path = join(root, relativePath)
      if (files.has(path)) continue
      try {
        const stat = await fsStat(path)
        if (stat.ino && process.platform !== 'win32') {
          const inode = `${stat.dev}:${stat.ino}`
          if (seenIno.has(inode)) continue
          seenIno.add(inode)
        }
        files.set(path, { path, mtimeMs: stat.mtimeMs, size: stat.size })
      } catch {}
    }
  }
  return files
}

export async function collectSessionFiles(
  roots: readonly string[],
  predicate: (path: string) => boolean,
  since: number,
): Promise<SessionFile[]> {
  // Call sites pass the same predicate source for the same roots on every poll.
  const key = `${roots.join('\0')}\0${Function.prototype.toString.call(predicate)}`
  const now = Date.now()
  let scan = scans.get(key)
  if (scan && now - scan.fullAt < FULL_SCAN_EVERY_MS) {
    const hot = [...scan.files.values()].filter(file => now - file.mtimeMs < HOT_FILE_WINDOW_MS)
    await mapLimit(hot, 8, async (file) => {
      try {
        const stat = await fsStat(file.path)
        if (stat.mtimeMs !== file.mtimeMs || stat.size !== file.size) {
          scan!.files.set(file.path, { path: file.path, mtimeMs: stat.mtimeMs, size: stat.size })
        }
      } catch {
        scan!.files.delete(file.path)
      }
    })
  } else {
    scan = { fullAt: now, files: await scanSessionFiles(roots, predicate) }
    scans.delete(key)
    if (scans.size >= MAX_SCANS) scans.delete(scans.keys().next().value as string)
    scans.set(key, scan)
  }
  return [...scan.files.values()].filter(file => file.mtimeMs >= since)
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  const worker = async () => { while (i < items.length) await fn(items[i++]) }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export async function loadCachedEntries<State = unknown>(
  files: SessionFile[],
  parse: (path: string) => Promise<Entry[]>,
  since: number,
  options?: UsageCacheOptions<State>,
): Promise<Entry[]> {
  const { store, key } = storeFor(parse, options)
  // All-time loads (since 0) run every few minutes and are large; only the
  // bounded dashboard window is worth holding between polls.
  const memoKey = since > 0
    ? hash(`${key}\0${Math.floor(since / DAY_MS)}\0${files.map(f => `${f.path}\0${f.mtimeMs}\0${f.size}`).sort().join('\n')}`)
    : null
  if (memoKey) {
    const memoized = loadMemo.get(memoKey)
    if (memoized) {
      loadMemo.delete(memoKey)
      loadMemo.set(memoKey, memoized)
      return memoized
    }
  }
  const parseRange = options?.parseRange
  const parseResume = options?.parseResume
  const chunks: Entry[][] = []
  let settled = true
  await mapLimit(files, 8, async (f) => {
    try {
      const loaded = parseResume
        ? await store.loadTracked(f, () => parseResume(f.path, 0, f.size), (from, state) => parseResume(f.path, from, f.size, state))
        : parseRange
        ? await store.loadTracked(f, () => parseRange(f.path, 0, f.size), from => parseRange(f.path, from, f.size))
        : await store.loadTracked(f, () => parse(f.path))
      if (!loaded.settled) settled = false
      // Do not keep stale rows alive in the request accumulator just because
      // they share a recently modified source log with useful rows.
      chunks.push(loaded.entries.filter(e => e.ts >= since))
    } catch {
      settled = false
    }
  })
  const entries = dedupe(chunks.flat())
  if (memoKey && settled) {
    if (loadMemo.size >= MAX_LOAD_MEMO) loadMemo.delete(loadMemo.keys().next().value as string)
    loadMemo.set(memoKey, entries)
  }
  return entries
}

// Walk calendar days via each day's start (not fixed 24h steps, which skip the
// spring-forward day and double-count the fall-back day). Returns keys oldest-first.
export function lastDayKeys(now: number, tz: string, n: number): string[] {
  const keys: string[] = []
  let cursor = now
  for (let i = 0; i < n; i++) {
    keys.unshift(dayKey(cursor, tz))
    cursor = startOfDay(cursor, tz) - DAY_MS / 2 // midpoint of the previous day in any DST regime
  }
  return keys
}

export function dashboardSince(tz: string): number {
  const now = Date.now()
  return Math.min(startOfMonth(now, tz), startOfWeek(now, tz), now - SPARK_DAYS * DAY_MS)
}

export function tableSince(_tz: string): number {
  return 0
}

const isClean = (x: number) => Number.isFinite(x) && x >= 0

function cleanEntry(e: Entry): Entry {
  // Rows that came through dedupe are already clean; copying each one again on
  // every aggregation pass is the bulk of a poll's garbage.
  if (isClean(e.ts) && isClean(e.cost) && isClean(e.input) && isClean(e.output)
    && isClean(e.cacheCreate) && isClean(e.cacheRead) && isClean(e.cacheSavings)) return e
  return {
    ...e,
    ts: finitePositive(e.ts),
    cost: finitePositive(e.cost),
    input: finitePositive(e.input),
    output: finitePositive(e.output),
    cacheCreate: finitePositive(e.cacheCreate),
    cacheRead: finitePositive(e.cacheRead),
    cacheSavings: finitePositive(e.cacheSavings),
  }
}

export function dedupe(entries: Entry[]): Entry[] {
  const byKey = new Map<string, Entry>()
  for (const raw of entries) {
    const e = cleanEntry(raw)
    if (e.ts <= 0) continue
    const k = e.id ?? `${e.ts} ${e.model} ${e.input} ${e.output} ${e.cacheCreate} ${e.cacheRead} ${e.cost}`
    byKey.set(k, e)
  }
  return [...byKey.values()]
}

export function summarize(entries: Entry[], tz: string): DashboardData {
  const now = Date.now()
  const todayStart = startOfDay(now, tz)
  const weekStart = startOfWeek(now, tz)
  const monthStart = startOfMonth(now, tz)

  const today: UsageSummary = { cost: 0, tokens: 0, input: 0, cacheRead: 0, cacheSavings: 0 }
  const week: UsageSummary = { cost: 0, tokens: 0, input: 0, cacheRead: 0, cacheSavings: 0 }
  const month: UsageSummary = { cost: 0, tokens: 0, input: 0, cacheRead: 0, cacheSavings: 0 }
  const byDay = new Map<string, number>()
  let oldestToday = now
  let hadToday = false
  let lastActivityAt: number | null = null

  const add = (s: UsageSummary, e: Entry) => {
    s.cost += e.cost
    s.tokens += e.input + e.output + e.cacheCreate + e.cacheRead
    s.input += e.input
    s.cacheRead += e.cacheRead
    s.cacheSavings += e.cacheSavings
  }
  for (const raw of entries) {
    const e = cleanEntry(raw)
    if (e.ts > 0 && (lastActivityAt === null || e.ts > lastActivityAt)) {
      lastActivityAt = Math.floor(e.ts)
    }
    if (e.ts >= monthStart) add(month, e)
    if (e.ts >= weekStart) add(week, e)
    if (e.ts >= todayStart) { add(today, e); hadToday = true; if (e.ts < oldestToday) oldestToday = e.ts }
    const dk = dayKey(e.ts, tz)
    byDay.set(dk, (byDay.get(dk) ?? 0) + e.cost)
  }

  const hrs = Math.max((now - oldestToday) / 3_600_000, 1 / 60)
  const rawBurnRate = hadToday ? today.cost / hrs : 0
  const burnRate = Number.isFinite(rawBurnRate) ? rawBurnRate : 0

  const series = lastDayKeys(now, tz, SPARK_DAYS).map(k => byDay.get(k) ?? 0)

  return { today, week, month, burnRate, series, lastActivityAt }
}

function groupBy(entries: Entry[], keyFn: (e: Entry) => string): TableRow[] {
  const groups = new Map<string, Entry[]>()
  for (const raw of entries) {
    const e = cleanEntry(raw)
    const key = keyFn(e)
    const arr = groups.get(key)
    if (arr) arr.push(e)
    else groups.set(key, [e])
  }

  const rows: TableRow[] = []
  for (const [label, group] of groups) {
    let input = 0, output = 0, cacheCreate = 0, cacheRead = 0, cacheSavings = 0, cost = 0, count = 0
    const byModel = new Map<string, ModelDetail>()

    for (const e of group) {
      const n = e.count ?? 1
      input += e.input
      output += e.output
      cacheCreate += e.cacheCreate
      cacheRead += e.cacheRead
      cacheSavings += e.cacheSavings
      cost += e.cost
      count += n

      const m = byModel.get(e.model)
      if (m) {
        m.input += e.input; m.output += e.output
        m.cacheCreate += e.cacheCreate; m.cacheRead += e.cacheRead
        m.cacheSavings += e.cacheSavings; m.cost += e.cost; m.count += n
      } else {
        byModel.set(e.model, {
          name: e.model, input: e.input, output: e.output,
          cacheCreate: e.cacheCreate, cacheRead: e.cacheRead,
          cacheSavings: e.cacheSavings, cost: e.cost, count: n,
        })
      }
    }

    rows.push({
      label, models: [...byModel.keys()].sort(),
      input, output, cacheCreate, cacheRead, cacheSavings,
      total: input + output + cacheCreate + cacheRead, cost, count,
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
      ex.cacheRead += r.cacheRead; ex.cacheSavings += r.cacheSavings
      ex.total += r.total; ex.cost += r.cost; ex.count += r.count
      const bd = new Map(ex.breakdown.map(m => [m.name, m]))
      for (const m of r.breakdown) {
        const e = bd.get(m.name)
        if (e) {
          e.input += m.input; e.output += m.output
          e.cacheCreate += m.cacheCreate; e.cacheRead += m.cacheRead
          e.cacheSavings += m.cacheSavings; e.cost += m.cost; e.count += m.count
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

export function mergeTables(list: TableData[]): TableData {
  return {
    daily: mergeRows(list.map(t => t.daily)),
    weekly: mergeRows(list.map(t => t.weekly)),
    monthly: mergeRows(list.map(t => t.monthly)),
  }
}

export function coalesceTables(list: TableData[]): TableData {
  if (list.length === 0) return { daily: [], weekly: [], monthly: [] }
  if (list.length === 1) return list[0]
  return mergeTables(list)
}
