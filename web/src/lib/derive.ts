import type { WebSnapshot, WebAccount, TableRow } from '@shared'
import { modelColor } from './colors'

export type PeriodKey = '7d' | '30d' | '90d' | 'mtd' | 'all'
export type Granularity = 'daily' | 'weekly' | 'monthly'

export interface Filters {
  providers: string[]
  models: string[]
  account: string
  period: PeriodKey
  gran: Granularity
}

export const DEFAULT_FILTERS: Filters = {
  providers: [],
  models: [],
  account: 'all',
  period: '30d',
  gran: 'daily',
}

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'mtd', label: 'month' },
  { key: 'all', label: 'all time' },
]

const DAY = 86_400_000
const parseDay = (label: string): number => {
  const [y, m, d] = label.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}
const fmtDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const weekStartStr = (label: string): string => {
  const ms = parseDay(label)
  const dow = (new Date(ms).getUTCDay() + 6) % 7
  return fmtDay(ms - dow * DAY)
}

export interface Totals {
  cost: number
  tokens: number
  cacheSavings: number
  calls: number
}
export interface ProviderAgg {
  id: string
  name: string
  color: string
  cost: number
  tokens: number
  calls: number
}
export interface ModelAgg {
  model: string
  color: string
  cost: number
  tokens: number
  cacheSavings: number
  calls: number
  share: number
  trend: number[]
}
export interface TimelinePoint {
  date: string
  total: number
  byProvider: Record<string, number>
}

export interface Derived {
  filteredAccounts: WebAccount[]
  totals: Totals
  today: Totals
  week: Totals
  month: Totals
  burnRate: number
  timeline: TimelinePoint[]
  cumulative: { date: string; total: number }[]
  cacheSavingsSeries: { date: string; value: number }[]
  calendar: { date: string; cost: number }[]
  byProvider: ProviderAgg[]
  byModel: ModelAgg[]
  tokenComposition: { input: number; output: number; cacheCreate: number; cacheRead: number }
  modelOptions: string[]
  latestDay: string | null
  rangeStart: string | null
}

const emptyTotals = (): Totals => ({ cost: 0, tokens: 0, cacheSavings: 0, calls: 0 })

function selectAccounts(snap: WebSnapshot, f: Filters): WebAccount[] {
  return snap.accounts.filter(a => {
    if (!a.hasUsage) return false
    if (f.account !== 'all' && a.id !== f.account) return false
    if (f.providers.length && !f.providers.includes(a.providerId)) return false
    return true
  })
}

function latestDayOf(accounts: WebAccount[]): string | null {
  let latest: string | null = null
  for (const a of accounts) {
    for (const r of a.table?.daily ?? []) {
      if (!latest || r.label > latest) latest = r.label
    }
  }
  return latest
}

function rangeStartOf(period: PeriodKey, latest: string | null): string | null {
  if (!latest || period === 'all') return null
  if (period === 'mtd') return latest.slice(0, 7) + '-01'
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30
  return fmtDay(parseDay(latest) - (days - 1) * DAY)
}

function summaryTotals(a: WebAccount, which: 'today' | 'week' | 'month'): Totals {
  const s = a.dashboard?.[which]
  if (!s) return emptyTotals()
  return { cost: s.cost, tokens: s.tokens, cacheSavings: s.cacheSavings, calls: 0 }
}

const addInto = (t: Totals, c: number, tok: number, sav: number, calls: number) => {
  t.cost += c; t.tokens += tok; t.cacheSavings += sav; t.calls += calls
}

export function deriveAll(snap: WebSnapshot | null, f: Filters): Derived {
  const accounts = snap ? selectAccounts(snap, f) : []
  const latestDay = latestDayOf(accounts)
  const rangeStart = rangeStartOf(f.period, latestDay)
  const modelSet = f.models.length ? new Set(f.models) : null

  const providerColor = new Map<string, string>()
  const providerName = new Map<string, string>()
  for (const p of snap?.providers ?? []) {
    providerColor.set(p.id, p.color)
    providerName.set(p.id, p.name)
  }

  const totals = emptyTotals()
  const today = emptyTotals(); const week = emptyTotals(); const month = emptyTotals()
  let burnRate = 0

  const timelineMap = new Map<string, TimelinePoint>()
  const cacheByDay = new Map<string, number>()
  const provAgg = new Map<string, ProviderAgg>()
  const modelAgg = new Map<string, { cost: number; tokens: number; cacheSavings: number; calls: number }>()
  const modelTrend = new Map<string, Map<string, number>>() // model -> date -> cost
  const modelOptionSet = new Set<string>()
  const tokenComposition = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }

  const inRange = (label: string) => !rangeStart || label >= rangeStart

  for (const a of accounts) {
    addInto(today, ...totalsOf(summaryTotals(a, 'today')))
    addInto(week, ...totalsOf(summaryTotals(a, 'week')))
    addInto(month, ...totalsOf(summaryTotals(a, 'month')))
    burnRate += a.dashboard?.burnRate ?? 0

    const pid = a.providerId
    const color = providerColor.get(pid) ?? a.color

    for (const row of a.table?.daily ?? []) {
      if (!inRange(row.label)) continue
      let rCost = 0, rTok = 0, rSav = 0, rCalls = 0
      for (const m of row.breakdown) {
        modelOptionSet.add(m.name)
        if (modelSet && !modelSet.has(m.name)) continue
        const tok = m.input + m.output + m.cacheCreate + m.cacheRead
        rCost += m.cost; rTok += tok; rSav += m.cacheSavings; rCalls += m.count

        tokenComposition.input += m.input
        tokenComposition.output += m.output
        tokenComposition.cacheCreate += m.cacheCreate
        tokenComposition.cacheRead += m.cacheRead

        const ma = modelAgg.get(m.name) ?? { cost: 0, tokens: 0, cacheSavings: 0, calls: 0 }
        ma.cost += m.cost; ma.tokens += tok; ma.cacheSavings += m.cacheSavings; ma.calls += m.count
        modelAgg.set(m.name, ma)

        let tr = modelTrend.get(m.name)
        if (!tr) { tr = new Map(); modelTrend.set(m.name, tr) }
        tr.set(row.label, (tr.get(row.label) ?? 0) + m.cost)
      }
      if (modelSet && rCalls === 0 && rCost === 0) continue

      addInto(totals, rCost, rTok, rSav, rCalls)

      const tp = timelineMap.get(row.label) ?? { date: row.label, total: 0, byProvider: {} }
      tp.total += rCost
      tp.byProvider[pid] = (tp.byProvider[pid] ?? 0) + rCost
      timelineMap.set(row.label, tp)

      cacheByDay.set(row.label, (cacheByDay.get(row.label) ?? 0) + rSav)

      const pa = provAgg.get(pid) ?? { id: pid, name: providerName.get(pid) ?? pid, color, cost: 0, tokens: 0, calls: 0 }
      pa.cost += rCost; pa.tokens += rTok; pa.calls += rCalls
      provAgg.set(pid, pa)
    }
  }

  const timeline = [...timelineMap.values()].sort((x, y) => x.date.localeCompare(y.date))

  let running = 0
  const cumulative = timeline.map(p => { running += p.total; return { date: p.date, total: running } })
  const cacheSavingsSeries = timeline.map(p => ({ date: p.date, value: cacheByDay.get(p.date) ?? 0 }))
  const calendar = timeline.map(p => ({ date: p.date, cost: p.total }))

  const byProvider = [...provAgg.values()].sort((x, y) => y.cost - x.cost)

  const dates = timeline.map(p => p.date)
  const byModel: ModelAgg[] = [...modelAgg.entries()]
    .map(([model, v]) => {
      const tr = modelTrend.get(model)
      return {
        model,
        color: modelColor(model),
        cost: v.cost, tokens: v.tokens, cacheSavings: v.cacheSavings, calls: v.calls,
        share: totals.cost > 0 ? v.cost / totals.cost : 0,
        trend: dates.map(d => tr?.get(d) ?? 0),
      }
    })
    .sort((x, y) => y.cost - x.cost)

  return {
    filteredAccounts: accounts,
    totals, today, week, month, burnRate,
    timeline, cumulative, cacheSavingsSeries, calendar,
    byProvider, byModel, tokenComposition,
    modelOptions: [...modelOptionSet].sort(),
    latestDay, rangeStart,
  }
}

function totalsOf(t: Totals): [number, number, number, number] {
  return [t.cost, t.tokens, t.cacheSavings, t.calls]
}

export function exploreRows(snap: WebSnapshot | null, f: Filters): TableRow[] {
  if (!snap) return []
  const accounts = selectAccounts(snap, f)
  const latest = latestDayOf(accounts)
  const dailyCut = rangeStartOf(f.period, latest)
  const cutoff = !dailyCut ? null
    : f.gran === 'monthly' ? dailyCut.slice(0, 7)
      : f.gran === 'weekly' ? weekStartStr(dailyCut)
        : dailyCut
  const modelSet = f.models.length ? new Set(f.models) : null

  const byLabel = new Map<string, TableRow>()
  for (const a of accounts) {
    for (const row of a.table?.[f.gran] ?? []) {
      if (cutoff && row.label < cutoff) continue
      const bd = modelSet ? row.breakdown.filter(m => modelSet.has(m.name)) : row.breakdown
      if (modelSet && bd.length === 0) continue
      const ex = byLabel.get(row.label)
      const recompute = (rows: typeof bd) => rows.reduce((acc, m) => {
        acc.input += m.input; acc.output += m.output; acc.cacheCreate += m.cacheCreate
        acc.cacheRead += m.cacheRead; acc.cacheSavings += m.cacheSavings; acc.cost += m.cost; acc.count += m.count
        return acc
      }, { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, cost: 0, count: 0 })
      const sums = recompute(bd)
      if (!ex) {
        byLabel.set(row.label, {
          label: row.label,
          models: bd.map(m => m.name).sort(),
          ...sums,
          total: sums.input + sums.output + sums.cacheCreate + sums.cacheRead,
          breakdown: bd.map(m => ({ ...m })),
        })
      } else {
        ex.input += sums.input; ex.output += sums.output; ex.cacheCreate += sums.cacheCreate
        ex.cacheRead += sums.cacheRead; ex.cacheSavings += sums.cacheSavings
        ex.total += sums.input + sums.output + sums.cacheCreate + sums.cacheRead
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
