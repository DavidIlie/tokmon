import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { type Entry, summarize, tabulate, finitePositive, dashboardSince, tableSince } from '../usage-core'
import { EPOCH_SECONDS_BOUNDARY } from '../_shared/time'
import { runSqlite } from '../cursor/sqlite'

export function opencodeDbPaths(homeDir?: string): string[] {
  const base = homeDir ?? homedir()
  const paths: string[] = []
  if (!homeDir && process.env.XDG_DATA_HOME) paths.push(join(process.env.XDG_DATA_HOME, 'opencode', 'opencode.db'))
  paths.push(join(base, '.local', 'share', 'opencode', 'opencode.db'))
  if (process.platform === 'darwin') paths.push(join(base, 'Library', 'Application Support', 'opencode', 'opencode.db'))
  if (process.platform === 'win32') {
    const lad = homeDir ? join(homeDir, 'AppData', 'Local') : process.env.LOCALAPPDATA
    if (lad) paths.push(join(lad, 'opencode', 'opencode.db'))
  }
  return [...new Set(paths)]
}

async function findDb(homeDir?: string): Promise<string | null> {
  for (const p of opencodeDbPaths(homeDir)) {
    try { await access(p); return p } catch {}
  }
  return null
}

export async function detectOpencode(homeDir?: string): Promise<boolean> {
  return (await findDb(homeDir)) !== null
}

// opencode's tokens.output already includes reasoning tokens (empirically,
// tokens.total = input + output + cache.read + cache.write with reasoning
// excluded), so we must NOT add reasoning again or output/total inflates.
export function rowToEntry(row: Record<string, unknown>): Entry | null {
  const ts = finitePositive(row.ts)
  if (!ts) return null
  const input = finitePositive(row.input)
  const output = finitePositive(row.output)
  const cacheRead = finitePositive(row.cacheRead)
  const cacheCreate = finitePositive(row.cacheWrite)
  if (input + output + cacheRead + cacheCreate === 0) return null
  return {
    ts,
    model: typeof row.model === 'string' && row.model ? row.model : 'unknown',
    cost: finitePositive(row.cost),
    input,
    output,
    cacheCreate,
    cacheRead,
    cacheSavings: 0,
  }
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const db = await findDb(homeDir)
  if (!db) return []
  // Checked 2026-11-09: https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/session/sql.ts
  // and https://github.com/anomalyco/opencode/blob/v1.19.5/packages/schema/src/session-message.ts
  // New records keep type in a column and model.id in data; migrations retain message IDs.
  const tables = await runSqlite(db, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('message', 'session_message')")
  if (tables.status !== 'ok') return []
  const names = new Set(tables.rows.map(row => row.name))
  const entriesById = new Map<string, Entry>()
  for (const table of ['message', 'session_message']) {
    if (!names.has(table)) continue
    const modern = table === 'session_message'
    const timestamp = `CASE WHEN time_created < ${EPOCH_SECONDS_BOUNDARY} THEN time_created * 1000 ELSE time_created END`
    const sql = `SELECT id, ${timestamp} AS ts, ` +
      `json_extract(data,'$.${modern ? 'model.id' : 'modelID'}') AS model, ` +
      "json_extract(data,'$.cost') AS cost, json_extract(data,'$.tokens.input') AS input, " +
      "json_extract(data,'$.tokens.output') AS output, " +
      "json_extract(data,'$.tokens.cache.read') AS cacheRead, json_extract(data,'$.tokens.cache.write') AS cacheWrite " +
      `FROM ${table} WHERE json_valid(data) AND ${modern ? "type='assistant'" : "json_extract(data,'$.role')='assistant'"} ` +
      `AND json_type(data,'$.tokens')='object' AND (${timestamp}) >= ?`
    const result = await runSqlite(db, sql, [Math.floor(since)])
    if (result.status !== 'ok') continue
    for (const row of result.rows) {
      const entry = rowToEntry(row)
      if (!entry) continue
      const id = String(row.id)
      const previous = entriesById.get(id)
      if (row.cost == null && previous) entry.cost = previous.cost
      entriesById.set(id, entry)
    }
  }
  return [...entriesById.values()]
}

export async function opencodeDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  return summarize(await loadEntries(dashboardSince(tz), homeDir), tz)
}

export async function opencodeTable(tz: string, homeDir?: string): Promise<TableData> {
  return tabulate(await loadEntries(tableSince(tz), homeDir), tz)
}
