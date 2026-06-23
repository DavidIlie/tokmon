import type { CalendarDay } from './derive'
import { DAY, MONTHS, dowMonday, fmtDay as fmtDate, parseDay as parseDate } from './date'

export const HEAT_OPACITY = [0, 0.32, 0.55, 0.78, 1]
export const heatFill = (level: number) => {
  if (level === 0) return 'var(--color-bg-2)'
  return `color-mix(in oklab, var(--color-cost) ${HEAT_OPACITY[level] * 100}%, var(--color-bg-2))`
}
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Cell { date: string; cost: number; level: number }

export function buildCalendarStats(calendar: CalendarDay[], weightOf: (c: CalendarDay) => number) {
  const cal = calendar
  const active = cal.filter(c => weightOf(c) > 0)
  if (active.length === 0) return null
  const total = cal.reduce((s, c) => s + weightOf(c), 0)
  const top = active.reduce((m, c) => (weightOf(c) > weightOf(m) ? c : m))
  const dow = new Array(7).fill(0)
  for (const c of cal) dow[dowMonday(parseDate(c.date))] += weightOf(c)
  const busiest = dow.indexOf(Math.max(...dow))
  const activeSet = new Set(active.map(c => c.date))
  let streak = 0
  for (let ms = parseDate(active[active.length - 1].date); activeSet.has(fmtDate(ms)); ms -= DAY) streak++
  return { active: active.length, total, top, avg: total / active.length, busiest, streak, costed: calendar.some(c => c.cost > 0) }
}

export function buildCalendarGrid(calendar: CalendarDay[], maxWeeks: number, weightOf: (c: CalendarDay) => number): {
  weeks: (Cell | null)[][]
  monthLabels: { col: number; text: string }[]
} | null {
  const map = new Map(calendar.map(c => [c.date, weightOf(c)]))
  if (calendar.length === 0) return null
  const last = calendar[calendar.length - 1].date
  const firstData = calendar[0].date
  let endMs = parseDate(last)
  let startMs = parseDate(firstData)
  if ((endMs - startMs) / (DAY * 7) > maxWeeks) startMs = endMs - maxWeeks * 7 * DAY
  startMs -= dowMonday(startMs) * DAY
  const max = Math.max(...calendar.map(weightOf), 0)
  const levelOf = (cost: number) => {
    if (cost <= 0 || max <= 0) return 0
    const r = cost / max
    return r > 0.66 ? 4 : r > 0.4 ? 3 : r > 0.15 ? 2 : 1
  }
  const weeks: (Cell | null)[][] = []
  let col: (Cell | null)[] = new Array(7).fill(null)
  const monthLabels: { col: number; text: string }[] = []
  let lastMonth = -1
  let colIdx = 0
  for (let ms = startMs; ms <= endMs; ms += DAY) {
    const d = fmtDate(ms)
    const wd = dowMonday(ms)
    if (wd === 0 && col.some(Boolean)) { weeks.push(col); col = new Array(7).fill(null); colIdx++ }
    const month = new Date(ms).getUTCMonth()
    if (month !== lastMonth && wd === 0) { monthLabels.push({ col: colIdx, text: MONTHS[month] }); lastMonth = month }
    const inData = ms >= parseDate(firstData)
    col[wd] = inData ? { date: d, cost: map.get(d) ?? 0, level: levelOf(map.get(d) ?? 0) } : null
  }
  if (col.some(Boolean)) weeks.push(col)
  return { weeks, monthLabels }
}
