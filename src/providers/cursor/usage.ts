import { cursorStateDb } from './billing'
import { runSqlite } from './sqlite'
import { type Entry, summarize, tabulate, safeNum, dashboardSince, tableSince } from '../usage-core'
import { dayKey } from '../../tz'
import { cursorUsageTable } from './composer'
import type { DashboardData, TableData, TableRow } from '../../types'
import { monthKey, weekKey } from '../../tz'

const EVENTS_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetFilteredUsageEvents'
const WINDOW_DAYS = 90
const PAGE_SIZE = 1000
const MAX_PAGES = 12
const CACHE_TTL_MS = 60_000

const SKIP_KINDS = new Set(['USAGE_EVENT_KIND_ABORTED_NOT_CHARGED', 'USAGE_EVENT_KIND_ERRORED_NOT_CHARGED'])

interface TokenUsage { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; totalCents?: number }
interface UsageEvent { timestamp?: string; model?: string; kind?: string; chargedCents?: number; tokenUsage?: TokenUsage }
interface EventsResponse { totalUsageEventsCount?: number; usageEventsDisplay?: UsageEvent[] }

type CacheSlot = { at: number; entries: Entry[]; complete: boolean }
const apiCache = new Map<string, CacheSlot>()
const apiInflight = new Map<string, Promise<{ entries: Entry[]; complete: boolean }>>()

async function readToken(homeDir?: string): Promise<string | null> {
  const r = await runSqlite(cursorStateDb(homeDir), "SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken' LIMIT 1;")
  const raw = r.status === 'ok' ? r.rows[0]?.value : undefined
  if (typeof raw !== 'string' || !raw.trim()) return null
  return raw.trim().replace(/^"|"$/g, '')
}

async function fetchPage(token: string, startMs: number, endMs: number, page: number): Promise<EventsResponse | null> {
  try {
    const res = await fetch(EVENTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'User-Agent': 'tokmon',
      },
      body: JSON.stringify({ startDate: String(startMs), endDate: String(endMs), page, pageSize: PAGE_SIZE }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    return await res.json() as EventsResponse
  } catch {
    return null
  }
}

function eventToEntry(e: UsageEvent): Entry | null {
  if (e.kind && SKIP_KINDS.has(e.kind)) return null
  const rawTs = e.timestamp
  const ts = typeof rawTs === 'number'
    ? rawTs
    : typeof rawTs === 'string' && rawTs.trim()
      ? (/^\d+$/.test(rawTs.trim()) ? Number(rawTs) : Date.parse(rawTs))
      : NaN
  if (!Number.isFinite(ts) || ts <= 0) return null
  const tu = e.tokenUsage ?? {}
  const input = safeNum(tu.inputTokens)
  const output = safeNum(tu.outputTokens)
  const cacheRead = safeNum(tu.cacheReadTokens)
  const charged = Number(e.chargedCents)
  const totalCents = Number(tu.totalCents)
  const cents = Number.isFinite(charged) && charged > 0
    ? charged
    : (Number.isFinite(totalCents) && totalCents > 0 ? totalCents : 0)
  const cost = cents > 0 ? cents / 100 : 0
  if (cost <= 0 && input + output + cacheRead === 0) return null
  return {
    ts,
    id: `${ts}|${e.model ?? ''}|${input}|${output}|${cacheRead}|${cents}`,
    model: String(e.model ?? 'unknown'),
    cost,
    input,
    output,
    cacheCreate: 0,
    cacheRead,
    cacheSavings: 0,
    count: 1,
  }
}

async function fetchApiEntries(homeDir?: string): Promise<{ entries: Entry[]; complete: boolean }> {
  const cacheKey = homeDir ?? ''
  const hit = apiCache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { entries: hit.entries, complete: hit.complete }

  const existing = apiInflight.get(cacheKey)
  if (existing) return existing

  const promise = (async () => {
    const token = await readToken(homeDir)
    if (!token) return { entries: [] as Entry[], complete: true }

    const endMs = Date.now()
    const startMs = endMs - WINDOW_DAYS * 86_400_000
    const events: UsageEvent[] = []
    let complete = true
    for (let page = 1; page <= MAX_PAGES; page++) {
      const resp = await fetchPage(token, startMs, endMs, page)
      if (!resp) {
        // Transient failure mid-pagination — do not treat as authoritative.
        complete = false
        break
      }
      const batch = resp.usageEventsDisplay ?? []
      events.push(...batch)
      if (batch.length < PAGE_SIZE) break
      if (page === MAX_PAGES) complete = false // hit ceiling; may be truncated
    }

    const entries: Entry[] = []
    for (const e of events) {
      const entry = eventToEntry(e)
      if (entry) entries.push(entry)
    }
    // Only cache complete fetches so a blip can't suppress local composer rows for 60s.
    if (complete) apiCache.set(cacheKey, { at: Date.now(), entries, complete: true })
    return { entries, complete }
  })()

  apiInflight.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    apiInflight.delete(cacheKey)
  }
}

interface LocalDayEntry {
  /** Timezone-local day label from composer (YYYY-MM-DD) — keep as-is for overlay. */
  day: string
  entry: Entry
}

/** Local composer spend as Entry[] (cost + request count; no token breakdown). */
async function fetchLocalEntries(tz: string, homeDir?: string): Promise<LocalDayEntry[]> {
  const table = await cursorUsageTable(tz, homeDir)
  if (!table) return []
  // composer table is already bucketed by tz-local dayKey. Keep the label for overlay
  // instead of round-tripping through Date.UTC noon (breaks UTC+12…+14).
  const out: LocalDayEntry[] = []
  for (const day of table.daily) {
    const [y, mo, d] = day.label.split('-').map(Number)
    const ts = Date.UTC(y, mo - 1, d, 12)
    if (!Number.isFinite(ts)) continue
    for (const b of day.breakdown) {
      out.push({
        day: day.label,
        entry: {
          ts,
          model: b.name,
          cost: b.cost,
          count: Math.max(1, b.count),
          input: 0,
          output: 0,
          cacheCreate: 0,
          cacheRead: 0,
          cacheSavings: 0,
        },
      })
    }
  }
  return out
}

function overlayEntries(api: Entry[], local: LocalDayEntry[], tz: string): Entry[] {
  if (api.length === 0) return local.map(l => l.entry)
  if (local.length === 0) return api
  const apiDays = new Set(api.map(e => dayKey(e.ts, tz)))
  return [...api, ...local.filter(l => !apiDays.has(l.day)).map(l => l.entry)]
}

async function cursorEntries(since: number, tz: string, homeDir?: string): Promise<Entry[]> {
  const [apiResult, local] = await Promise.all([fetchApiEntries(homeDir), fetchLocalEntries(tz, homeDir)])
  // Incomplete fetches still contribute the days they cover; they just aren't cached
  // and only suppress local rows for those days (not the whole window).
  return overlayEntries(apiResult.entries, local, tz).filter(e => e.ts >= since)
}

export async function cursorDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  return summarize(await cursorEntries(dashboardSince(tz), tz, homeDir), tz)
}

export async function cursorTableFull(tz: string, homeDir?: string): Promise<TableData> {
  return tabulate(await cursorEntries(tableSince(tz), tz, homeDir), tz)
}

/** @deprecated Prefer cursorTableFull — kept for callers that want the raw API table only. */
export async function cursorApiUsage(tz: string, homeDir?: string): Promise<TableData | null> {
  const { entries } = await fetchApiEntries(homeDir)
  if (entries.length === 0) return null
  const table = tabulate(entries, tz)
  return table.daily.length ? table : null
}

const EMPTY: TableData = { daily: [], weekly: [], monthly: [] }

const overlayDaily = (lo: TableRow[], hi: TableRow[]): TableRow[] => {
  const m = new Map(lo.map(r => [r.label, r]))
  for (const r of hi) m.set(r.label, r)
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function reBucket(daily: TableRow[], tz: string, keyOf: (ts: number, tz: string) => string): TableRow[] {
  const out = new Map<string, TableRow>()
  for (const day of daily) {
    const [y, mo, d] = day.label.split('-').map(Number)
    const ts = Date.UTC(y, mo - 1, d, 12)
    if (!Number.isFinite(ts)) continue
    const label = keyOf(ts, tz)
    let row = out.get(label)
    if (!row) {
      row = { label, models: [], input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, total: 0, cost: 0, count: 0, breakdown: [] }
      out.set(label, row)
    }
    row.input += day.input; row.output += day.output; row.cacheCreate += day.cacheCreate; row.cacheRead += day.cacheRead
    row.cacheSavings += day.cacheSavings; row.total += day.total; row.cost += day.cost; row.count += day.count
    for (const b of day.breakdown) {
      let md = row.breakdown.find(x => x.name === b.name)
      if (!md) {
        md = { name: b.name, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, cost: 0, count: 0 }
        row.breakdown.push(md)
      }
      md.input += b.input; md.output += b.output; md.cacheCreate += b.cacheCreate; md.cacheRead += b.cacheRead
      md.cacheSavings += b.cacheSavings; md.cost += b.cost; md.count += b.count
    }
  }
  return [...out.values()].map(r => {
    r.breakdown.sort((a, b) => b.cost - a.cost)
    r.models = r.breakdown.map(b => b.name)
    return r
  }).sort((a, b) => a.label.localeCompare(b.label))
}

/** Legacy overlay table used before Entry pipeline — still useful as fallback. */
export async function cursorLegacyTable(tz: string, homeDir?: string): Promise<TableData> {
  const [api, local] = await Promise.all([cursorApiUsage(tz, homeDir), cursorUsageTable(tz, homeDir)])
  if (!api && !local) return EMPTY
  const daily = overlayDaily(local?.daily ?? [], api?.daily ?? [])
  if (daily.length === 0) return EMPTY
  return { daily, weekly: reBucket(daily, tz, weekKey), monthly: reBucket(daily, tz, monthKey) }
}
