import type { WebSnapshot, WebAccount, TableRow } from '@shared'
import { modelColor } from './colors'
import { DAY, fmtDay, parseDay, weekStartStr } from './date'

export type PeriodKey = '7d' | '30d' | '90d' | 'mtd' | 'all'
export type Granularity = 'daily' | 'weekly' | 'monthly'

export interface Filters {
  providers: string[]
  models: string[]
  account: string
  period: PeriodKey
}

export const DEFAULT_FILTERS: Filters = {
  providers: [],
  models: [],
  account: 'all',
  // Default to full history so first paint shows everything; chips narrow from there.
  period: 'all',
}

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'mtd', label: 'month' },
  { key: 'all', label: 'all time' },
]


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
  share: number       // cost share (kept for SummaryCard/breakdown)
  tokenShare: number  // token share — drives the bar when sorting by tokens
  callShare: number   // call share — drives the bar when sorting by calls
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
  today: Totals
  week: Totals
  month: Totals
  burnRate: number
  timeline: TimelinePoint[]
  cumulative: { date: string; total: number }[]
  cacheSavingsSeries: { date: string; value: number }[]
  calendar: CalendarDay[]
  // Accounts shown as provider cards: usage accounts plus billing-only accounts that
  // carry live quota/plan metrics (period/usage filters don't strip the latter).
  cardAccounts: WebAccount[]
  byProvider: ProviderAgg[]
  byModel: ModelAgg[]
  tokenComposition: { input: number; output: number; cacheCreate: number; cacheRead: number }
  modelOptions: string[]
  latestDay: string | null
  rangeStart: string | null
}

const emptyTotals = (): Totals => ({ cost: 0, tokens: 0, cacheSavings: 0, calls: 0 })

// A provider filter that resolves to no usage accounts (e.g. a stale ?p=cursor link
// to a billing-only provider) is treated as a no-op rather than blanking the dashboard.
function activeProviderFilter(snap: WebSnapshot, f: Filters): Set<string> | null {
  if (!f.providers.length) return null
  const usable = new Set<string>(snap.accounts.filter(a => a.hasUsage).map(a => a.providerId))
  const eff = f.providers.filter(p => usable.has(p))
  return eff.length ? new Set(eff) : null
}

function selectAccounts(snap: WebSnapshot, f: Filters): WebAccount[] {
  const provFilter = activeProviderFilter(snap, f)
  return snap.accounts.filter(a => {
    if (!a.hasUsage) return false
    if (f.account !== 'all' && a.id !== f.account) return false
    if (provFilter && !provFilter.has(a.providerId)) return false
    return true
  })
}

// A billing account worth showing as a card: it has a plan, live metrics, a
// per-model spend table, activity, or an actionable error to surface.
export function hasBillingSignal(a: WebAccount): boolean {
  return !!(a.hasBilling && (
    a.billing?.metrics?.length || a.billing?.plan || a.billing?.error ||
    a.billing?.activity?.series?.length || a.billing?.modelSpend?.length
  ))
}

// Card surface: usage accounts + billing-only accounts that carry a billing signal,
// honoring the account filter (and the effective provider filter where it applies).
function selectCardAccounts(snap: WebSnapshot, f: Filters): WebAccount[] {
  const provFilter = activeProviderFilter(snap, f)
  return snap.accounts.filter(a => {
    if (!a.hasUsage && !hasBillingSignal(a)) return false
    if (f.account !== 'all' && a.id !== f.account) return false
    // Only constrain by provider when that provider filter is meaningful (has usage);
    // billing-only providers aren't filterable chips, so don't strip them here.
    if (provFilter && a.hasUsage && !provFilter.has(a.providerId)) return false
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

// Explore window: bucket SIZE (granularity) is decoupled from window LENGTH (period).
// Daily honors the period exactly; weekly/monthly widen to a floor (~12 buckets) so a
// short period never collapses them to one row — and 'all' always stays all-time.
function granRangeStart(period: PeriodKey, gran: Granularity, latest: string | null): string | null {
  if (!latest || period === 'all') return null
  const periodStart = rangeStartOf(period, latest)
  if (gran === 'daily') return periodStart
  const floorDays = gran === 'monthly' ? 365 : 84
  const floorStart = fmtDay(parseDay(latest) - (floorDays - 1) * DAY)
  // The earlier (smaller) start wins, so coarse views show at least the floor.
  return periodStart && periodStart < floorStart ? periodStart : floorStart
}

function summaryTotals(a: WebAccount, which: 'today' | 'week' | 'month'): Totals {
  const s = a.dashboard?.[which]
  if (!s) return emptyTotals()
  return { cost: s.cost, tokens: s.tokens, cacheSavings: s.cacheSavings, calls: 0 }
}

const addInto = (t: Totals, c: number, tok: number, sav: number, calls: number) => {
  t.cost += c; t.tokens += tok; t.cacheSavings += sav; t.calls += calls
}

interface AccState {
  totals: Totals
  today: Totals
  week: Totals
  month: Totals
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
    today: emptyTotals(),
    week: emptyTotals(),
    month: emptyTotals(),
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

function accumulateSummary(acc: AccState, a: WebAccount): void {
  const totalsOf = (t: Totals): [number, number, number, number] =>
    [t.cost, t.tokens, t.cacheSavings, t.calls]
  addInto(acc.today, ...totalsOf(summaryTotals(a, 'today')))
  addInto(acc.week, ...totalsOf(summaryTotals(a, 'week')))
  addInto(acc.month, ...totalsOf(summaryTotals(a, 'month')))
  acc.burnRate += a.dashboard?.burnRate ?? 0
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
    const tok = m.input + m.output + m.cacheCreate + m.cacheRead
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
  const rangeStart = rangeStartOf(f.period, latestDay)
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
    accumulateSummary(acc, a)
    const pid = a.providerId
    const color = providerColor.get(pid) ?? a.color
    for (const row of a.table?.daily ?? []) {
      if (!inRange(row.label)) continue
      accumulateDayRow(acc, row, pid, color, modelSet)
    }
  }

  // Patch provider names in after the loop (available from snap.providers).
  for (const pa of acc.provAgg.values()) {
    const name = providerName.get(pa.id)
    if (name) pa.name = name
  }

  const timeline = buildTimeline(acc)

  let running = 0
  const cumulative = timeline.map(p => { running += p.total; return { date: p.date, total: running } })
  const cacheSavingsSeries = timeline.map(p => ({ date: p.date, value: acc.cacheByDay.get(p.date) ?? 0 }))
  // Calendar reflects the selected period (scoped via inRange, like every other panel);
  // carries per-day model spend + call/token/savings detail for the hover card.
  const dayDetail = new Map<string, { tokens: number; calls: number; cacheSavings: number; models: Map<string, number> }>()
  for (const a of accounts) {
    for (const row of a.table?.daily ?? []) {
      if (!inRange(row.label)) continue
      const bd = modelSet ? row.breakdown.filter(m => modelSet.has(m.name)) : row.breakdown
      if (modelSet && bd.length === 0) continue
      let dd = dayDetail.get(row.label)
      if (!dd) { dd = { tokens: 0, calls: 0, cacheSavings: 0, models: new Map() }; dayDetail.set(row.label, dd) }
      for (const m of bd) {
        dd.tokens += m.input + m.output + m.cacheCreate + m.cacheRead
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
    totals: acc.totals, today: acc.today, week: acc.week, month: acc.month,
    burnRate: acc.burnRate,
    timeline, cumulative, cacheSavingsSeries, calendar,
    cardAccounts: snap ? selectCardAccounts(snap, f) : [],
    byProvider, byModel, tokenComposition: acc.tokenComposition,
    modelOptions: [...acc.modelOptionSet].sort(),
    latestDay, rangeStart,
  }
}

// Sum a (filtered) per-model breakdown into one totals object.
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
