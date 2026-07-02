import type { Provider } from '../types'
import type { ModelDetail, TableData, TableRow } from '../../types'
import { monthKey, weekKey } from '../../tz'
import { detectCursor, cursorBilling } from './billing'
import { cursorUsageTable } from './composer'
import { cursorApiUsage } from './usage'

const EMPTY: TableData = { daily: [], weekly: [], monthly: [] }

const overlayDaily = (lo: TableRow[], hi: TableRow[]): TableRow[] => {
  const m = new Map(lo.map(r => [r.label, r]))
  for (const r of hi) m.set(r.label, r)
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function reBucket(daily: TableRow[], tz: string, keyOf: (ts: number, tz: string) => string): TableRow[] {
  const out = new Map<string, TableRow>()
  for (const day of daily) {
    const [y, mo, d] = day.label.split('-').map(Number)
    const ts = Date.UTC(y, mo - 1, d, 12) // noon UTC avoids tz day-shift
    if (!Number.isFinite(ts)) continue
    const label = keyOf(ts, tz)
    let row = out.get(label)
    if (!row) {
      row = { label, models: [], input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, total: 0, cost: 0, count: 0, breakdown: [] }
      out.set(label, row)
    }
    row.input += day.input; row.output += day.output; row.cacheCreate += day.cacheCreate; row.cacheRead += day.cacheRead
    row.cacheSavings += day.cacheSavings; row.total += day.total; row.cost += day.cost; row.count += day.count
    for (const b of day.breakdown) {
      let md = row.breakdown.find(x => x.name === b.name)
      if (!md) { md = { name: b.name, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, cost: 0, count: 0 } satisfies ModelDetail; row.breakdown.push(md) }
      md.input += b.input; md.output += b.output; md.cacheCreate += b.cacheCreate; md.cacheRead += b.cacheRead
      md.cacheSavings += b.cacheSavings; md.cost += b.cost; md.count += b.count
    }
  }
  return [...out.values()].map(r => { r.breakdown.sort((a, b) => b.cost - a.cost); r.models = r.breakdown.map(b => b.name); return r })
    .sort((a, b) => a.label.localeCompare(b.label))
}

async function cursorTable(tz: string, homeDir?: string): Promise<TableData> {
  const [api, local] = await Promise.all([cursorApiUsage(tz, homeDir), cursorUsageTable(tz, homeDir)])
  if (!api && !local) return EMPTY
  const daily = overlayDaily(local?.daily ?? [], api?.daily ?? [])
  if (daily.length === 0) return EMPTY
  return { daily, weekly: reBucket(daily, tz, weekKey), monthly: reBucket(daily, tz, monthKey) }
}

export const cursorProvider: Provider = {
  id: 'cursor',
  name: 'Cursor',
  color: 'magenta',
  hasUsage: false,
  hasBilling: true,
  detect: (homeDir) => detectCursor(homeDir),
  fetchTable: (account, tz) => cursorTable(tz, account.homeDir),
  fetchBilling: (account, tz) => cursorBilling(account, tz),
}
