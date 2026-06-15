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
  const sql =
    "SELECT mk.key, sum(json_extract(mk.value,'$.costInCents')), sum(json_extract(mk.value,'$.amount')) " +
    "FROM cursorDiskKV c, json_each(c.value,'$.usageData') mk WHERE c.key LIKE 'composerData:%' " +
    "AND json_valid(c.value) AND json_type(c.value,'$.usageData')='object' GROUP BY mk.key ORDER BY 2 DESC;"
  const res = await runSqlite(db, sql, ['-separator', '\t'])
  if (res.status !== 'ok') return null
  const models: CursorModelSpend[] = []
  let total = 0
  for (const line of res.stdout.trim().split('\n')) {
    if (!line) continue
    const [name, cents, amt] = line.split('\t')
    const usd = (Number(cents) || 0) / 100
    if (usd <= 0) continue
    models.push({ name, usd, requests: Number(amt) || 0 })
    total += usd
  }
  if (total <= 0) return null
  return { total, models }
}
