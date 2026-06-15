import { join } from 'node:path'
import { homedir } from 'node:os'
import * as fmt from '../../format'
import { SPARK_DAYS } from '../usage-core'
import { runSqlite } from './sqlite'

const DAY_MS = 86_400_000

/**
 * Cursor's local AI-code tracker (`~/.cursor/ai-tracking/ai-code-tracking.db`)
 * records each AI-written code hash with a source, model, and timestamp. Cursor
 * exposes no local token/cost history, so this AI-code activity is the most
 * meaningful "usage history" we can surface for it.
 */
export function trackingDb(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.cursor', 'ai-tracking', 'ai-code-tracking.db')
}

function localDayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Last-SPARK_DAYS daily AI-code line counts + a 30-day summary, or null if unavailable. */
export async function cursorActivity(homeDir?: string): Promise<{ series: number[]; summary: string } | null> {
  const db = trackingDb(homeDir)
  try {
    const now = Date.now()
    // One query: 30 days of daily AI-line counts → derive both the 14-day
    // sparkline and the 30-day total without a second sqlite invocation.
    const res = await runSqlite(db,
      `SELECT date(createdAt/1000,'unixepoch','localtime') AS d, count(*) AS c FROM ai_code_hashes ` +
      `WHERE source!='human' AND createdAt >= ${Math.floor(now - 30 * DAY_MS)} GROUP BY d;`)
    if (res.status !== 'ok') return null

    const byDay = new Map<string, number>()
    let month = 0
    for (const row of res.rows) {
      const n = Number(row.c) || 0
      byDay.set(String(row.d), n)
      month += n
    }
    const series: number[] = []
    for (let i = SPARK_DAYS - 1; i >= 0; i--) series.push(byDay.get(localDayKey(now - i * DAY_MS)) ?? 0)

    if (month === 0 && series.every(v => v === 0)) return null
    return { series, summary: `${fmt.tokens(month)} lines` }
  } catch {
    return null
  }
}
