import type { WebSnapshot, TableRow } from '@shared'
import { weekStartStr } from './date'
import { sumTokens } from './format'
import { selectAccounts, latestDayOf, granRangeStart, rangeStartOf, type Filters, type Granularity } from './derive.filters'

export interface ModelSpotlightAccount {
  name: string
  color: string
  provider: string
  providerId: string
  tokens: number
  cost: number
}

export interface ModelSpotlightTotals {
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
  cost: number
  count: number
}

export interface ModelSpotlightDay {
  day: string
  cost: number
  tokens: number
}

export interface ModelSpotlightData {
  accounts: ModelSpotlightAccount[]
  totals: ModelSpotlightTotals
  daily: ModelSpotlightDay[]
}

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
  const dailyCut = granRangeStart(f.period, gran, latest, snap.tz)
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

function emptyModelTotals(): ModelSpotlightTotals {
  return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0, count: 0 }
}

function addModelTotals(t: ModelSpotlightTotals, m: TableRow['breakdown'][number]): void {
  t.input += m.input
  t.output += m.output
  t.cacheCreate += m.cacheCreate
  t.cacheRead += m.cacheRead
  t.cost += m.cost
  t.count += m.count
}

export function deriveModelSpotlight(snap: WebSnapshot | null, f: Filters, model: string): ModelSpotlightData | null {
  if (!snap) return null
  const accounts = selectAccounts(snap, f)
  const latest = latestDayOf(accounts)
  const rangeStart = rangeStartOf(f.period, latest, snap.tz)
  const inRange = (label: string) => !rangeStart || label >= rangeStart
  const providerName = new Map(snap.providers.map(p => [p.id, p.name]))

  const totals = emptyModelTotals()
  const daily = new Map<string, ModelSpotlightDay>()
  const accountRows: ModelSpotlightAccount[] = []

  for (const account of accounts) {
    const accountTotals = emptyModelTotals()
    for (const row of account.table?.daily ?? []) {
      if (!inRange(row.label)) continue
      const detail = row.breakdown.find(m => m.name === model)
      if (!detail) continue

      const tokens = sumTokens(detail)
      addModelTotals(totals, detail)
      addModelTotals(accountTotals, detail)

      const day = daily.get(row.label) ?? { day: row.label, cost: 0, tokens: 0 }
      day.cost += detail.cost
      day.tokens += tokens
      daily.set(row.label, day)
    }

    const accountTokens = sumTokens(accountTotals)
    if (accountTokens > 0 || accountTotals.cost > 0 || accountTotals.count > 0) {
      accountRows.push({
        name: account.name,
        color: account.color,
        provider: providerName.get(account.providerId) ?? account.providerId,
        providerId: account.providerId,
        tokens: accountTokens,
        cost: accountTotals.cost,
      })
    }
  }

  return {
    accounts: accountRows.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens || a.name.localeCompare(b.name)),
    totals,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
  }
}
