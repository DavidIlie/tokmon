import { cursorStateDb } from './billing'
import { runSqlite } from './sqlite'
import { dayKey, monthKey, weekKey } from '../../tz'
import type { ModelDetail, TableData, TableRow } from '../../types'

// Cursor's dashboard API exposes authoritative per-event usage — model (incl.
// composer-2.5-fast), token counts, and notional cost — which the local state.vscdb
// stopped recording in early 2026. This is the richer, current source; the local
// composerData table (composer.ts) is the offline fallback.
const EVENTS_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetFilteredUsageEvents'
// 90 days keeps the fetch to a few pages (~5s) while covering recent models like
// composer-2.5; a heavy user's full year is ~14 pages / ~20s, too slow for the poll.
const WINDOW_DAYS = 90
const PAGE_SIZE = 1000
const MAX_PAGES = 12 // safety bound; one fetch runs at most every 5 min (idle-gated)

// Aborted/errored turns carry token counts but no real usage — drop them.
const SKIP_KINDS = new Set(['USAGE_EVENT_KIND_ABORTED_NOT_CHARGED', 'USAGE_EVENT_KIND_ERRORED_NOT_CHARGED'])

interface TokenUsage { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; totalCents?: number }
interface UsageEvent { timestamp?: string; model?: string; kind?: string; chargedCents?: number; tokenUsage?: TokenUsage }
interface EventsResponse { totalUsageEventsCount?: number; usageEventsDisplay?: UsageEvent[] }

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

export async function cursorApiUsage(tz: string, homeDir?: string): Promise<TableData | null> {
  const token = await readToken(homeDir)
  if (!token) return null

  const endMs = Date.now()
  const startMs = endMs - WINDOW_DAYS * 86_400_000
  const events: UsageEvent[] = []
  let total = Infinity
  for (let page = 1; page <= MAX_PAGES && events.length < total; page++) {
    const resp = await fetchPage(token, startMs, endMs, page)
    if (!resp) return page === 1 ? null : finalizeTable(events, tz) // token bad/offline on page 1 → fall back
    total = resp.totalUsageEventsCount ?? 0
    const batch = resp.usageEventsDisplay ?? []
    events.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return finalizeTable(events, tz)
}

function finalizeTable(events: UsageEvent[], tz: string): TableData | null {
  if (events.length === 0) return null
  const buckets = { daily: new Map<string, TableRow>(), weekly: new Map<string, TableRow>(), monthly: new Map<string, TableRow>() }
  const put = (map: Map<string, TableRow>, label: string, model: string, usd: number, input: number, output: number, cacheRead: number) => {
    let row = map.get(label)
    if (!row) {
      row = { label, models: [], input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, total: 0, cost: 0, count: 0, breakdown: [] }
      map.set(label, row)
    }
    row.input += input; row.output += output; row.cacheRead += cacheRead
    row.total += input + output + cacheRead
    row.cost += usd; row.count += 1
    let md = row.breakdown.find(b => b.name === model)
    if (!md) {
      md = { name: model, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, cost: 0, count: 0 } satisfies ModelDetail
      row.breakdown.push(md)
    }
    md.input += input; md.output += output; md.cacheRead += cacheRead; md.cost += usd; md.count += 1
  }

  for (const e of events) {
    if (e.kind && SKIP_KINDS.has(e.kind)) continue
    const ts = Number(e.timestamp)
    if (!Number.isFinite(ts) || ts <= 0) continue
    const tu = e.tokenUsage ?? {}
    const input = Number(tu.inputTokens) || 0
    const output = Number(tu.outputTokens) || 0
    const cacheRead = Number(tu.cacheReadTokens) || 0
    const usd = (Number(e.chargedCents) || 0) / 100
    if (usd <= 0 && input + output + cacheRead === 0) continue
    const model = String(e.model ?? 'unknown')
    put(buckets.daily, dayKey(ts, tz), model, usd, input, output, cacheRead)
    put(buckets.weekly, weekKey(ts, tz), model, usd, input, output, cacheRead)
    put(buckets.monthly, monthKey(ts, tz), model, usd, input, output, cacheRead)
  }

  const sortRows = (map: Map<string, TableRow>): TableRow[] =>
    [...map.values()].map(row => {
      row.breakdown.sort((a, b) => b.cost - a.cost)
      row.models = row.breakdown.map(b => b.name)
      return row
    }).sort((a, b) => a.label.localeCompare(b.label))

  const table = { daily: sortRows(buckets.daily), weekly: sortRows(buckets.weekly), monthly: sortRows(buckets.monthly) }
  return table.daily.length ? table : null
}
