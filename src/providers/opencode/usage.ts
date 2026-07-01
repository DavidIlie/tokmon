import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { type Entry, summarize, tabulate, finitePositive, dashboardSince, tableSince } from '../usage-core'
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

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const db = await findDb(homeDir)
  if (!db) return []
  const sql =
    "SELECT CASE WHEN time_created < 10000000000 THEN time_created * 1000 ELSE time_created END AS ts, json_extract(data,'$.modelID') AS model, " +
    "json_extract(data,'$.cost') AS cost, json_extract(data,'$.tokens.input') AS input, " +
    "json_extract(data,'$.tokens.output') AS output, json_extract(data,'$.tokens.reasoning') AS reasoning, " +
    "json_extract(data,'$.tokens.cache.read') AS cacheRead, json_extract(data,'$.tokens.cache.write') AS cacheWrite " +
    "FROM message WHERE json_valid(data) AND json_extract(data,'$.role')='assistant' " +
    "AND json_type(data,'$.tokens')='object' AND (CASE WHEN time_created < 10000000000 THEN time_created * 1000 ELSE time_created END) >= ?;"
  const res = await runSqlite(db, sql, [Math.floor(since)])
  if (res.status !== 'ok') return []
  const entries: Entry[] = []
  for (const row of res.rows) {
    const ts = finitePositive(row.ts)
    if (!ts) continue
    const input = finitePositive(row.input)
    const output = finitePositive(row.output) + finitePositive(row.reasoning)
    const cacheRead = finitePositive(row.cacheRead)
    const cacheCreate = finitePositive(row.cacheWrite)
    if (input + output + cacheRead + cacheCreate === 0) continue
    entries.push({
      ts,
      model: typeof row.model === 'string' && row.model ? row.model : 'unknown',
      cost: finitePositive(row.cost),
      input,
      output,
      cacheCreate,
      cacheRead,
      cacheSavings: 0,
    })
  }
  return entries
}

export async function opencodeDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  return summarize(await loadEntries(dashboardSince(tz), homeDir), tz)
}

export async function opencodeTable(tz: string, homeDir?: string): Promise<TableData> {
  return tabulate(await loadEntries(tableSince(tz), homeDir), tz)
}
