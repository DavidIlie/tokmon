import type { WebSnapshot, TableRow } from '@shared'
import { weekStartStr } from './date'
import { sumTokens } from './format'
import { selectAccounts, latestDayOf, granRangeStart, type Filters, type Granularity } from './derive.filters'

function sumBreakdown(rows: TableRow['breakdown']) {
  return rows.reduce((agg, m) => {
    agg.input += m.input; agg.output += m.output; agg.cacheCreate += m.cacheCreate
    agg.cacheRead += m.cacheRead; agg.cacheSavings += m.cacheSavings; agg.cost += m.cost; agg.count += m.count
    return agg
  }, { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, cost: 0, count: 0 })
}

export function exploreRows(snap: WebSnapshot | null, f: Filters, gran: Granularity): TableRow[] {
  if (!snap) return []
  const accounts = selectAccounts(snap, f)
  const latest = latestDayOf(accounts)
  const dailyCut = granRangeStart(f.period, gran, latest)
  const cutoff = !dailyCut ? null
    : gran === 'monthly' ? dailyCut.slice(0, 7)
      : gran === 'weekly' ? weekStartStr(dailyCut)
        : dailyCut
  const modelSet = f.models.length ? new Set(f.models) : null

  const byLabel = new Map<string, TableRow>()
  for (const a of accounts) {
    for (const row of a.table?.[gran] ?? []) {
      if (cutoff && row.label < cutoff) continue
      const bd = modelSet ? row.breakdown.filter(m => modelSet.has(m.name)) : row.breakdown
      if (modelSet && bd.length === 0) continue
      const ex = byLabel.get(row.label)
      const sums = sumBreakdown(bd)
      if (!ex) {
        byLabel.set(row.label, {
          label: row.label,
          models: bd.map(m => m.name).sort(),
          ...sums,
          total: sumTokens(sums),
          breakdown: bd.map(m => ({ ...m })),
        })
      } else {
        ex.input += sums.input; ex.output += sums.output; ex.cacheCreate += sums.cacheCreate
        ex.cacheRead += sums.cacheRead; ex.cacheSavings += sums.cacheSavings
        ex.total += sumTokens(sums)
        ex.cost += sums.cost; ex.count += sums.count
        const map = new Map(ex.breakdown.map(m => [m.name, m]))
        for (const m of bd) {
          const e = map.get(m.name)
          if (e) {
            e.input += m.input; e.output += m.output; e.cacheCreate += m.cacheCreate
            e.cacheRead += m.cacheRead; e.cacheSavings += m.cacheSavings; e.cost += m.cost; e.count += m.count
          } else map.set(m.name, { ...m })
        }
        ex.breakdown = [...map.values()].sort((p, q) => q.cost - p.cost)
        ex.models = ex.breakdown.map(m => m.name)
      }
    }
  }
  return [...byLabel.values()]
}
