import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

export type SqliteStatus = 'ok' | 'missing' | 'locked' | 'old' | 'error'
export interface SqliteResult { status: SqliteStatus; stdout: string }

/**
 * Run a read-only sqlite3 query against Cursor's store, classifying failures so
 * callers can show a useful message instead of a generic "not signed in":
 *   missing → sqlite3 CLI absent · old → no JSON1 support · locked → DB busy.
 */
export async function runSqlite(db: string, sql: string, extraArgs: string[] = []): Promise<SqliteResult> {
  try {
    const { stdout } = await execFile(
      'sqlite3',
      ['-readonly', '-cmd', 'PRAGMA busy_timeout=1500;', ...extraArgs, db, sql],
      { timeout: 10000, maxBuffer: 8 << 20 },
    )
    return { status: 'ok', stdout }
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string }
    if (err?.code === 'ENOENT') return { status: 'missing', stdout: '' }
    const msg = String(err?.stderr ?? err?.message ?? '')
    if (/database is (locked|busy)/i.test(msg)) return { status: 'locked', stdout: '' }
    if (/no such function|unknown option|no such table/i.test(msg)) return { status: 'old', stdout: '' }
    return { status: 'error', stdout: '' }
  }
}

export function sqliteStatusMessage(status: SqliteStatus): string {
  switch (status) {
    case 'missing': return 'sqlite3 CLI not found — install it to read Cursor'
    case 'old': return 'sqlite3 too old (needs JSON support)'
    case 'locked': return 'Cursor DB busy — retrying next poll'
    default: return 'Cursor data unavailable'
  }
}
