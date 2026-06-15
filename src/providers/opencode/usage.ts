import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { startOfMonth, startOfWeek, monthsAgoStart } from '../../tz'
import { type Entry, summarize, tabulate, SPARK_DAYS } from '../usage-core'
import { runSqlite } from '../cursor/sqlite'

// opencode (SST) stores every message in a single SQLite DB (`message` table:
// `time_created` ms + a JSON `data` column). Assistant rows carry providerID /
// modelID, the token breakdown, and opencode's own computed `cost`. opencode is
// multi-provider and much of its usage is subscription-/free-tier (cost 0), so
// we surface the stored cost as-is (actual marginal spend) plus token volumes —
// the same way openusage reads it, rather than re-pricing every model.
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

const pos = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const db = await findDb(homeDir)
  if (!db) return []
  const sql =
    "SELECT time_created AS ts, json_extract(data,'$.modelID') AS model, " +
    "json_extract(data,'$.cost') AS cost, json_extract(data,'$.tokens.input') AS input, " +
    "json_extract(data,'$.tokens.output') AS output, json_extract(data,'$.tokens.reasoning') AS reasoning, " +
    "json_extract(data,'$.tokens.cache.read') AS cacheRead, json_extract(data,'$.tokens.cache.write') AS cacheWrite " +
    "FROM message WHERE json_valid(data) AND json_extract(data,'$.role')='assistant' " +
    "AND json_type(data,'$.tokens')='object' AND time_created >= ?;"
  const res = await runSqlite(db, sql, [Math.floor(since)])
  if (res.status !== 'ok') return []
  const entries: Entry[] = []
  for (const row of res.rows) {
    const ts = pos(row.ts)
    if (!ts) continue
    const input = pos(row.input)
    const output = pos(row.output)  // opencode's output total already includes reasoning tokens
    const cacheRead = pos(row.cacheRead)
    const cacheCreate = pos(row.cacheWrite)
    if (input + output + cacheRead + cacheCreate === 0) continue
    entries.push({
      ts,
      model: typeof row.model === 'string' && row.model ? row.model : 'unknown',
      cost: pos(row.cost),
      input,
      output,
      cacheCreate,
      cacheRead,
      cacheSavings: 0,  // opencode stores only a total cost, no per-component split to derive savings
    })
  }
  return entries
}

export async function opencodeDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  const now = Date.now()
  const since = Math.min(startOfMonth(now, tz), startOfWeek(now, tz), now - SPARK_DAYS * 86_400_000)
  return summarize(await loadEntries(since, homeDir), tz)
}

export async function opencodeTable(tz: string, homeDir?: string): Promise<TableData> {
  return tabulate(await loadEntries(monthsAgoStart(Date.now(), 6, tz), homeDir), tz)
}
