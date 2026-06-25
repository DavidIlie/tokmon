import { cursorStateDb } from './billing'
import { runSqlite } from './sqlite'
import { dayKey, monthKey, weekKey } from '../../tz'
import type { ModelDetail, TableData, TableRow } from '../../types'
import { finitePositiveCoerced as finiteNonNegative } from '../_shared/metric'

export interface CursorModelSpend {
  name: string
  usd: number
  requests: number
}
export interface CursorSpend {
  total: number
  models: CursorModelSpend[]
}

export async function cursorModelSpend(homeDir?: string): Promise<CursorSpend | null> {
  const db = cursorStateDb(homeDir)
  const sql =
    "SELECT mk.key AS name, sum(json_extract(mk.value,'$.costInCents')) AS cents, " +
    "sum(json_extract(mk.value,'$.amount')) AS amt " +
    "FROM cursorDiskKV c, json_each(c.value,'$.usageData') mk WHERE c.key LIKE 'composerData:%' " +
    "AND json_valid(c.value) AND json_type(c.value,'$.usageData')='object' GROUP BY mk.key ORDER BY cents DESC;"
  const res = await runSqlite(db, sql)
  if (res.status !== 'ok') return null
  const models: CursorModelSpend[] = []
  let total = 0
  for (const row of res.rows) {
    const usd = finiteNonNegative(row.cents) / 100
    if (usd <= 0) continue
    models.push({ name: String(row.name ?? ''), usd, requests: finiteNonNegative(row.amt) })
    total += usd
  }
  if (total <= 0) return null
  return { total, models }
}

const USAGE_SQL =
  "SELECT json_extract(c.value,'$.createdAt') AS createdAt, mk.key AS model, " +
  "sum(json_extract(mk.value,'$.costInCents')) AS cents, " +
  "sum(json_extract(mk.value,'$.amount')) AS amt " +
  "FROM cursorDiskKV c, json_each(c.value,'$.usageData') mk " +
  "WHERE c.key LIKE 'composerData:%' AND json_valid(c.value) " +
  "AND json_type(c.value,'$.usageData')='object' " +
  "AND json_extract(c.value,'$.createdAt') IS NOT NULL " +
  "GROUP BY createdAt, model;"

export async function cursorUsageTable(tz: string, homeDir?: string): Promise<TableData | null> {
  const res = await runSqlite(cursorStateDb(homeDir), USAGE_SQL)
  if (res.status !== 'ok' || res.rows.length === 0) return null

  const buckets = { daily: new Map<string, TableRow>(), weekly: new Map<string, TableRow>(), monthly: new Map<string, TableRow>() }
  const put = (map: Map<string, TableRow>, label: string, model: string, usd: number, reqs: number) => {
    let row = map.get(label)
    if (!row) {
      row = { label, models: [], input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, total: 0, cost: 0, count: 0, breakdown: [] }
      map.set(label, row)
    }
    row.cost += usd
    row.count += reqs
    let md = row.breakdown.find(b => b.name === model)
    if (!md) {
      md = { name: model, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, cost: 0, count: 0 } satisfies ModelDetail
      row.breakdown.push(md)
    }
    md.cost += usd
    md.count += reqs
  }

  for (const r of res.rows) {
    const ts = Number(r.createdAt)
    if (!Number.isFinite(ts) || ts <= 0) continue
    const usd = finiteNonNegative(r.cents) / 100
    const reqs = finiteNonNegative(r.amt)
    if (usd <= 0 && reqs <= 0) continue
    const model = String(r.model ?? 'unknown')
    put(buckets.daily, dayKey(ts, tz), model, usd, reqs)
    put(buckets.weekly, weekKey(ts, tz), model, usd, reqs)
    put(buckets.monthly, monthKey(ts, tz), model, usd, reqs)
  }

  const finalize = (map: Map<string, TableRow>): TableRow[] =>
    [...map.values()].map(row => {
      row.breakdown.sort((a, b) => b.cost - a.cost)
      row.models = row.breakdown.map(b => b.name)
      return row
    }).sort((a, b) => a.label.localeCompare(b.label))

  const table = { daily: finalize(buckets.daily), weekly: finalize(buckets.weekly), monthly: finalize(buckets.monthly) }
  return table.daily.length ? table : null
}
