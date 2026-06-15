import { cursorStateDb } from './billing'
import { runSqlite } from './sqlite'

/**
 * Cursor records per-conversation spend in `cursorDiskKV` under composerData:*
 * as `usageData = { "<model>": { costInCents, amount } }`. Aggregating it
 * server-side (json_each, no blob materialization → ~0.3s, ~12MB RSS) gives a
 * live per-model cost breakdown the billing API doesn't expose. Bubble-level
 * tokenCount is deliberately ignored — Cursor stopped writing it in Jan 2026.
 */
export interface CursorModelSpend {
  name: string
  usd: number
  requests: number
}
export interface CursorSpend {
  total: number
  models: CursorModelSpend[]  // sorted desc by spend
}

export async function cursorModelSpend(homeDir?: string): Promise<CursorSpend | null> {
  const db = cursorStateDb(homeDir)
  // Columns are aliased because node:sqlite keys rows by the literal expression
  // text for unaliased aggregates (e.g. "sum(json_extract(...))").
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
    const usd = (Number(row.cents) || 0) / 100
    if (usd <= 0) continue
    models.push({ name: String(row.name ?? ''), usd, requests: Number(row.amt) || 0 })
    total += usd
  }
  if (total <= 0) return null
  return { total, models }
}
