import type { WebSnapshot, WebAccount } from '@shared'
import { modelColor } from './colors'
import { sumTokens } from './format'
import type { Filters } from './derive.filters'
import { selectAccounts, selectCardAccounts, latestDayOf, rangeStartOf } from './derive.filters'

export * from './derive.filters'
export { exploreRows } from './derive.explore'


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
  tokenShare: number
  callShare: number
  trend: number[]
}
export interface TimelinePoint {
  date: string
  total: number
  tokens: number
  byProvider: Record<string, number>
}
export interface CalendarDay {
  date: string
  cost: number
  tokens: number
  calls: number
  cacheSavings: number
  models: { name: string; cost: number }[]
}

export interface Derived {
  filteredAccounts: WebAccount[]
  totals: Totals
  burnRate: number
  timeline: TimelinePoint[]
  cumulative: { date: string; total: number }[]
  cacheSavingsSeries: { date: string; value: number }[]
  calendar: CalendarDay[]
  cardAccounts: WebAccount[]
  byProvider: ProviderAgg[]
  byModel: ModelAgg[]
  tokenComposition: { input: number; output: number; cacheCreate: number; cacheRead: number }
  modelOptions: string[]
  latestDay: string | null
  rangeStart: string | null
}

const emptyTotals = (): Totals => ({ cost: 0, tokens: 0, cacheSavings: 0, calls: 0 })

const addInto = (t: Totals, c: number, tok: number, sav: number, calls: number) => {
  t.cost += c; t.tokens += tok; t.cacheSavings += sav; t.calls += calls
}

interface AccState {
  totals: Totals
  burnRate: number
  timelineMap: Map<string, TimelinePoint>
  cacheByDay: Map<string, number>
  provAgg: Map<string, ProviderAgg>
  modelAgg: Map<string, { cost: number; tokens: number; cacheSavings: number; calls: number }>
  modelTrend: Map<string, Map<string, number>>
  modelOptionSet: Set<string>
  tokenComposition: { input: number; output: number; cacheCreate: number; cacheRead: number }
}

function makeAccState(): AccState {
  return {
    totals: emptyTotals(),
    burnRate: 0,
    timelineMap: new Map(),
    cacheByDay: new Map(),
    provAgg: new Map(),
    modelAgg: new Map(),
    modelTrend: new Map(),
    modelOptionSet: new Set(),
    tokenComposition: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  }
}

function accumulateDayRow(
  acc: AccState,
  row: { label: string; breakdown: { name: string; input: number; output: number; cacheCreate: number; cacheRead: number; cost: number; cacheSavings: number; count: number }[] },
  pid: string,
  color: string,
  modelSet: Set<string> | null,
): void {
  let rCost = 0, rTok = 0, rSav = 0, rCalls = 0

  for (const m of row.breakdown) {
    acc.modelOptionSet.add(m.name)
    if (modelSet && !modelSet.has(m.name)) continue
    const tok = sumTokens(m)
    rCost += m.cost; rTok += tok; rSav += m.cacheSavings; rCalls += m.count

    acc.tokenComposition.input += m.input
    acc.tokenComposition.output += m.output
    acc.tokenComposition.cacheCreate += m.cacheCreate
    acc.tokenComposition.cacheRead += m.cacheRead

    const ma = acc.modelAgg.get(m.name) ?? { cost: 0, tokens: 0, cacheSavings: 0, calls: 0 }
    ma.cost += m.cost; ma.tokens += tok; ma.cacheSavings += m.cacheSavings; ma.calls += m.count
    acc.modelAgg.set(m.name, ma)

    let tr = acc.modelTrend.get(m.name)
    if (!tr) { tr = new Map(); acc.modelTrend.set(m.name, tr) }
    tr.set(row.label, (tr.get(row.label) ?? 0) + m.cost)
  }

  if (modelSet && rCalls === 0 && rCost === 0) return

  addInto(acc.totals, rCost, rTok, rSav, rCalls)

  const tp = acc.timelineMap.get(row.label) ?? { date: row.label, total: 0, tokens: 0, byProvider: {} }
  tp.total += rCost
  tp.tokens += rTok
  tp.byProvider[pid] = (tp.byProvider[pid] ?? 0) + rCost
  acc.timelineMap.set(row.label, tp)

  acc.cacheByDay.set(row.label, (acc.cacheByDay.get(row.label) ?? 0) + rSav)

  const pa = acc.provAgg.get(pid) ?? { id: pid, name: pid, color, cost: 0, tokens: 0, calls: 0 }
  pa.cost += rCost; pa.tokens += rTok; pa.calls += rCalls
  acc.provAgg.set(pid, pa)
}

function buildTimeline(acc: AccState): TimelinePoint[] {
  return [...acc.timelineMap.values()].sort((x, y) => x.date.localeCompare(y.date))
}

function buildByModel(acc: AccState, timeline: TimelinePoint[], totalCost: number): ModelAgg[] {
  const dates = timeline.map(p => p.date)
  return [...acc.modelAgg.entries()]
    .map(([model, v]) => {
      const tr = acc.modelTrend.get(model)
      return {
        model,
        color: modelColor(model),
        cost: v.cost, tokens: v.tokens, cacheSavings: v.cacheSavings, calls: v.calls,
        share: totalCost > 0 ? v.cost / totalCost : 0,
        tokenShare: acc.totals.tokens > 0 ? v.tokens / acc.totals.tokens : 0,
        callShare: acc.totals.calls > 0 ? v.calls / acc.totals.calls : 0,
        trend: dates.map(d => tr?.get(d) ?? 0),
      }
    })
    .sort((x, y) => y.cost - x.cost)
}

export function deriveAll(snap: WebSnapshot | null, f: Filters): Derived {
  const accounts = snap ? selectAccounts(snap, f) : []
  const latestDay = latestDayOf(accounts)
  const rangeStart = rangeStartOf(f.period, latestDay, snap?.tz ?? '')
  const modelSet = f.models.length ? new Set(f.models) : null

  const providerColor = new Map<string, string>()
  const providerName = new Map<string, string>()
  for (const p of snap?.providers ?? []) {
    providerColor.set(p.id, p.color)
    providerName.set(p.id, p.name)
  }

  const acc = makeAccState()
  const inRange = (label: string) => !rangeStart || label >= rangeStart

  for (const a of accounts) {
    acc.burnRate += a.dashboard?.burnRate ?? 0
    const pid = a.providerId
    const color = providerColor.get(pid) ?? a.color
    for (const row of a.table?.daily ?? []) {
      if (!inRange(row.label)) continue
      accumulateDayRow(acc, row, pid, color, modelSet)
    }
  }

  for (const pa of acc.provAgg.values()) {
    const name = providerName.get(pa.id)
    if (name) pa.name = name
  }

  const timeline = buildTimeline(acc)

  let running = 0
  const cumulative = timeline.map(p => { running += p.total; return { date: p.date, total: running } })
  const cacheSavingsSeries = timeline.map(p => ({ date: p.date, value: acc.cacheByDay.get(p.date) ?? 0 }))
  const dayDetail = new Map<string, { tokens: number; calls: number; cacheSavings: number; models: Map<string, number> }>()
  for (const a of accounts) {
    for (const row of a.table?.daily ?? []) {
      if (!inRange(row.label)) continue
      const bd = modelSet ? row.breakdown.filter(m => modelSet.has(m.name)) : row.breakdown
      if (modelSet && bd.length === 0) continue
      let dd = dayDetail.get(row.label)
      if (!dd) { dd = { tokens: 0, calls: 0, cacheSavings: 0, models: new Map() }; dayDetail.set(row.label, dd) }
      for (const m of bd) {
        dd.tokens += sumTokens(m)
        dd.calls += m.count
        dd.cacheSavings += m.cacheSavings
        dd.models.set(m.name, (dd.models.get(m.name) ?? 0) + m.cost)
      }
    }
  }
  const calendar: CalendarDay[] = timeline.map(p => {
    const dd = dayDetail.get(p.date)
    return {
      date: p.date,
      cost: p.total,
      tokens: dd?.tokens ?? 0,
      calls: dd?.calls ?? 0,
      cacheSavings: dd?.cacheSavings ?? 0,
      models: dd ? [...dd.models.entries()].map(([name, cost]) => ({ name, cost })).sort((x, y) => y.cost - x.cost) : [],
    }
  })

  const byProvider = [...acc.provAgg.values()].sort((x, y) => y.cost - x.cost)
  const byModel = buildByModel(acc, timeline, acc.totals.cost)

  return {
    filteredAccounts: accounts,
    totals: acc.totals,
    burnRate: acc.burnRate,
    timeline, cumulative, cacheSavingsSeries, calendar,
    cardAccounts: snap ? selectCardAccounts(snap, f) : [],
    byProvider, byModel, tokenComposition: acc.tokenComposition,
    modelOptions: [...acc.modelOptionSet].sort(),
    latestDay, rangeStart,
  }
}
