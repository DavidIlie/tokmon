import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

export type SqliteStatus = 'ok' | 'missing' | 'locked' | 'old' | 'error'
export interface SqliteResult { status: SqliteStatus; rows: Record<string, unknown>[] }

let nativeDb: unknown
async function getNativeDb(): Promise<any> {
  if (nativeDb !== undefined) return nativeDb
  try {
    nativeDb = (await import('node:sqlite')).DatabaseSync
  } catch {
    nativeDb = null
  }
  return nativeDb
}

function classify(msg: string): SqliteStatus {
  if (/unable to open|no such file|cannot open|ENOENT/i.test(msg)) return 'missing'
  if (/database is (locked|busy)|readonly/i.test(msg)) return 'locked'
  if (/no such (function|table|column)|unknown option/i.test(msg)) return 'old'
  return 'error'
}

export async function runSqlite(db: string, sql: string, params: (string | number)[] = []): Promise<SqliteResult> {
  const DB = await getNativeDb()
  if (DB) {
    let handle: any
    try {
      handle = new DB(db, { readOnly: true, timeout: 1500 })
      const rows = handle.prepare(sql).all(...params) as Record<string, unknown>[]
      return { status: 'ok', rows }
    } catch {
    } finally {
      try { handle?.close() } catch {}
    }
  }
  return runSqliteCli(db, sql, params)
}

function inlineParams(sql: string, params: (string | number)[]): string {
  let i = 0
  return sql.replace(/\?/g, () => {
    const p = params[i++]
    return typeof p === 'number' ? String(p) : `'${String(p).replace(/'/g, "''")}'`
  })
}

async function runSqliteCli(db: string, sql: string, params: (string | number)[]): Promise<SqliteResult> {
  try {
    const { stdout } = await execFile(
      'sqlite3',
      ['-readonly', '-json', '-cmd', '.timeout 1500', db, inlineParams(sql, params)],
      { timeout: 10000, maxBuffer: 8 << 20 },
    )
    const text = stdout.trim()
    if (!text) return { status: 'ok', rows: [] }
    try {
      return { status: 'ok', rows: JSON.parse(text) }
    } catch {
      return { status: 'error', rows: [] }
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string }
    if (err?.code === 'ENOENT') return { status: 'missing', rows: [] }
    return { status: classify(String(err?.stderr ?? err?.message ?? '')), rows: [] }
  }
}

export function sqliteStatusMessage(status: SqliteStatus): string {
  switch (status) {
    case 'missing': return 'Cursor data not found — open Cursor'
    case 'old': return 'Cursor DB unreadable'
    case 'locked': return 'Cursor DB busy — retrying next poll'
    default: return 'Cursor data unavailable'
  }
}
