import { join } from 'node:path'
import { homedir } from 'node:os'
import * as fmt from '../../format'
import { SPARK_DAYS, lastDayKeys } from '../usage-core'
import { dayKey } from '../../tz'
import { runSqlite } from './sqlite'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export function trackingDb(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.cursor', 'ai-tracking', 'ai-code-tracking.db')
}

export async function cursorActivity(tz: string, homeDir?: string): Promise<{ series: number[]; summary: string } | null> {
  const db = trackingDb(homeDir)
  try {
    const now = Date.now()
    // Bucket by hour in SQL (cheap, tz-free), then fold hours into configured-tz days here —
    // sqlite's 'localtime' would silently use the OS timezone instead of the app setting.
    const res = await runSqlite(db,
      `SELECT createdAt/${HOUR_MS} AS h, count(*) AS c FROM ai_code_hashes ` +
      `WHERE source!='human' AND createdAt >= ${Math.floor(now - 30 * DAY_MS)} GROUP BY h;`)
    if (res.status !== 'ok') return null

    const byDay = new Map<string, number>()
    let month = 0
    for (const row of res.rows) {
      const raw = Number(row.c)
      const n = Number.isFinite(raw) && raw > 0 ? raw : 0
      const hour = Number(row.h)
      if (!Number.isFinite(hour)) continue
      const key = dayKey(hour * HOUR_MS + HOUR_MS / 2, tz)
      byDay.set(key, (byDay.get(key) ?? 0) + n)
      month += n
    }
    const series = lastDayKeys(now, tz, SPARK_DAYS).map(k => byDay.get(k) ?? 0)

    if (month === 0 && series.every(v => v === 0)) return null
    return { series, summary: `${fmt.tokens(month)} lines` }
  } catch {
    return null
  }
}
