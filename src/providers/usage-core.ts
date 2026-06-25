import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { UsageSummary, TableRow, ModelDetail, DashboardData, TableData } from '../types'
import { dayKey, monthKey, weekKey, startOfDay, startOfMonth, startOfWeek, monthsAgoStart } from '../tz'
import { cacheDir } from '../config'
import { finitePositive, safeNum } from './_shared/metric'

export { finitePositive, safeNum } from './_shared/metric'

export const SPARK_DAYS = 14
const DAY_MS = 86_400_000

export interface Entry {
  ts: number
  id?: string
  model: string
  cost: number
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  cacheSavings: number
}

const CACHE_VERSION = 4
const STABLE_AGE_MS = 5 * 60_000
const PRUNE_AGE_MS = 200 * DAY_MS
const memCache = new Map<string, { mtimeMs: number; size: number; entries: Entry[] }>()
let diskLoaded = false
let dirty = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

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
    return [e.ts, mi, e.input, e.output, e.cacheCreate, e.cacheRead, e.cost, e.cacheSavings, e.id ?? 0]
  })
  return { m: mtimeMs, s: size, mods, rows }
}

function decode(s: Shard): Entry[] {
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
  } catch {}
}

export async function flushDisk(): Promise<void> {
  if (!dirty) return
  const now = Date.now()
  const obj: Record<string, Shard> = {}
  for (const [path, v] of memCache) {
    if (now - v.mtimeMs > STABLE_AGE_MS && now - v.mtimeMs < PRUNE_AGE_MS) {
      obj[path] = encode(v.mtimeMs, v.size, v.entries)
    }
  }
  try {
    await mkdir(cacheDir(), { recursive: true })
    const tmp = `${cacheFile()}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(obj))
    await rename(tmp, cacheFile())
    dirty = false
  } catch {}
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; void flushDisk() }, 4000)
  flushTimer.unref?.()
}

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
      if (!c || c.mtimeMs !== f.mtimeMs || c.size !== f.size) {
        const entries = await parse(f.path)
        c = { mtimeMs: f.mtimeMs, size: f.size, entries }
        memCache.set(f.path, c)
        if (Date.now() - f.mtimeMs > STABLE_AGE_MS) dirty = true
      }
      chunks.push(c.entries)
    } catch {}
  })
  if (dirty) scheduleFlush()
  return dedupe(chunks.flat().filter(e => e.ts >= since))
}

export function dashboardSince(tz: string): number {
  const now = Date.now()
  return Math.min(startOfMonth(now, tz), startOfWeek(now, tz), now - SPARK_DAYS * DAY_MS)
}

export function tableSince(tz: string): number {
  return monthsAgoStart(Date.now(), 6, tz)
}

function cleanEntry(e: Entry): Entry {
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
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const raw of entries) {
    const e = cleanEntry(raw)
    if (e.ts <= 0) continue
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

  const add = (s: UsageSummary, e: Entry) => {
    s.cost += e.cost
    s.tokens += e.input + e.output + e.cacheCreate + e.cacheRead
    s.cacheRead += e.cacheRead
    s.cacheSavings += e.cacheSavings
  }
  for (const raw of entries) {
    const e = cleanEntry(raw)
    if (e.ts >= monthStart) add(month, e)
    if (e.ts >= weekStart) add(week, e)
    if (e.ts >= todayStart) { add(today, e); hadToday = true; if (e.ts < oldestToday) oldestToday = e.ts }
    const dk = dayKey(e.ts, tz)
    byDay.set(dk, (byDay.get(dk) ?? 0) + e.cost)
  }

  const hrs = Math.max((now - oldestToday) / 3_600_000, 1 / 60)
  const rawBurnRate = hadToday ? today.cost / hrs : 0
  const burnRate = Number.isFinite(rawBurnRate) ? rawBurnRate : 0

  const series: number[] = []
  for (let i = SPARK_DAYS - 1; i >= 0; i--) series.push(byDay.get(dayKey(now - i * DAY_MS, tz)) ?? 0)

  return { today, week, month, burnRate, series }
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
      input += e.input
      output += e.output
      cacheCreate += e.cacheCreate
      cacheRead += e.cacheRead
      cacheSavings += e.cacheSavings
      cost += e.cost
      count += 1

      const m = byModel.get(e.model)
      if (m) {
        m.input += e.input; m.output += e.output
        m.cacheCreate += e.cacheCreate; m.cacheRead += e.cacheRead
        m.cacheSavings += e.cacheSavings; m.cost += e.cost; m.count += 1
      } else {
        byModel.set(e.model, {
          name: e.model, input: e.input, output: e.output,
          cacheCreate: e.cacheCreate, cacheRead: e.cacheRead,
          cacheSavings: e.cacheSavings, cost: e.cost, count: 1,
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
