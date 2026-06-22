import { useMemo, useState } from 'react'
import type { CalendarDay, Derived } from '../../lib/derive'
import { fmtCost, fmtDayLabel, fmtNum, fmtTokens } from '../../lib/format'
import { modelColor, shortModel } from '../../lib/colors'
import { Panel, StatBlock } from '../ui'
import { DAY, MONTHS, dowMonday, fmtDay as fmtDate, parseDay as parseDate } from '../../lib/date'

const HEAT_OPACITY = [0, 0.32, 0.55, 0.78, 1]
const heatFill = (level: number) => {
  if (level === 0) return 'var(--color-bg-2)'
  return `color-mix(in oklab, var(--color-cost) ${HEAT_OPACITY[level] * 100}%, var(--color-bg-2))`
}
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Cell { date: string; cost: number; level: number }

export function CalendarHeatmap({ derived, maxWeeks = 26, periodLabel }: { derived: Derived; maxWeeks?: number; periodLabel?: string }) {
  const [hover, setHover] = useState<CalendarDay | null>(null)
  const [pinned, setPinned] = useState<CalendarDay | null>(null)
  const shown = hover ?? pinned
  const detail = useMemo(() => new Map(derived.calendar.map(c => [c.date, c])), [derived.calendar])
  const costed = useMemo(() => derived.calendar.some(c => c.cost > 0), [derived.calendar])
  const weightOf = (c: CalendarDay) => (costed ? c.cost : c.tokens)
  const stats = useMemo(() => {
    const cal = derived.calendar
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
    return { active: active.length, total, top, avg: total / active.length, busiest, streak, costed }
  }, [derived, costed])

  const grid = useMemo(() => {
    const map = new Map(derived.calendar.map(c => [c.date, weightOf(c)]))
    if (derived.calendar.length === 0) return null
    const last = derived.calendar[derived.calendar.length - 1].date
    const firstData = derived.calendar[0].date
    let endMs = parseDate(last)
    let startMs = parseDate(firstData)
    if ((endMs - startMs) / (DAY * 7) > maxWeeks) startMs = endMs - maxWeeks * 7 * DAY
    startMs -= dowMonday(startMs) * DAY
    const max = Math.max(...derived.calendar.map(weightOf), 0)
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
  }, [derived, maxWeeks])

  const cols = grid ? `repeat(${grid.weeks.length}, minmax(0,1fr))` : undefined
  const maxW = grid ? grid.weeks.length * 25 : undefined

  return (
    <>
    <Panel title="daily spend" titleTag={periodLabel} captureName="calendar">
      {!grid || !stats ? <div className="py-6 text-center text-xs text-fg-faint">no usage yet</div> : (
        <div className="grid gap-x-8 gap-y-5 pt-1 md:grid-cols-[minmax(0,1fr)_210px] md:items-start">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="pl-6">
              <div className="grid gap-[3px] text-[9px] text-fg-faint" style={{ gridTemplateColumns: cols, maxWidth: maxW }}>
                {grid.weeks.map((_, i) => {
                  const m = grid.monthLabels.find(l => l.col === i)
                  return <div key={i} className="truncate">{m?.text ?? ''}</div>
                })}
              </div>
            </div>
            <div className="flex gap-[3px]">
              <div className="flex w-5 shrink-0 flex-col gap-[3px] text-[9px] text-fg-faint">
                {['M', '', 'W', '', 'F', '', ''].map((d, i) => <div key={i} className="flex flex-1 items-center">{d}</div>)}
              </div>
              <div className="grid min-w-0 flex-1 gap-[3px]" style={{ gridTemplateColumns: cols, maxWidth: maxW }} onMouseLeave={() => setHover(null)}>
                {grid.weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-[3px]">
                    {week.map((cell, di) => cell === null
                      ? <div key={di} className="aspect-square" />
                      : (
                        <button
                          key={di}
                          type="button"
                          aria-label={`${fmtDayLabel(cell.date)} — click to pin`}
                          aria-pressed={pinned?.date === cell.date}
                          className={`aspect-square block rounded-[3px] p-0 transition duration-150 hover:scale-[1.18] hover:ring-1 hover:ring-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${pinned?.date === cell.date ? 'ring-1 ring-fg-bright' : ''}`}
                          style={{ background: heatFill(cell.level) }}
                          onMouseEnter={() => setHover(detail.get(cell.date) ?? null)}
                          onFocus={() => setHover(detail.get(cell.date) ?? null)}
                          onClick={() => setPinned(p => p?.date === cell.date ? null : (detail.get(cell.date) ?? null))}
                        />
                      ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5 pl-6 pt-1 text-[9px] text-fg-faint">
              less
              {[0, 1, 2, 3, 4].map(l => <span key={l} className="size-[11px] rounded-[2px]" style={{ background: heatFill(l) }} />)}
              more
            </div>
          </div>

          <div className="relative border-line-faint md:border-l md:pl-6">
            <div className={`grid grid-cols-2 gap-x-6 gap-y-4 transition-opacity duration-200 md:grid-cols-1 ${shown ? 'opacity-0' : 'opacity-100'}`}>
              <StatBlock label="busiest day" value={stats.costed ? fmtCost(stats.top.cost) : fmtTokens(stats.top.tokens)} sub={fmtDayLabel(stats.top.date)} valueClass="text-cost" />
              <StatBlock label="daily average" value={stats.costed ? fmtCost(stats.avg) : fmtTokens(stats.avg)} sub={`across ${stats.active} active days`} />
              <StatBlock label="top weekday" value={WEEKDAYS[stats.busiest]} valueClass="text-fg-bright" />
              <StatBlock label="current streak" value={`${stats.streak}d`} sub={stats.streak > 0 ? 'in a row' : 'idle today'} valueClass="text-positive" />
            </div>
            {shown && <div className="dialog-fade absolute inset-0 md:pl-6"><DayDetail day={shown} pinned={!hover && shown === pinned} /></div>}
          </div>
        </div>
      )}
    </Panel>
    </>
  )
}

function DayDetail({ day: d, pinned = false }: { day: CalendarDay; pinned?: boolean }) {
  return (
    <div className="font-mono text-[11px]">
      <div className="flex items-baseline justify-between gap-3 border-b border-line-faint pb-2">
        <span className="text-fg-dim">
          {WEEKDAYS[dowMonday(parseDate(d.date))]} · {fmtDayLabel(d.date)}
          {pinned && <span className="ml-1.5 text-[9px] uppercase tracking-wide text-accent">pinned</span>}
        </span>
        <span className="tnum text-cost">{d.cost > 0 ? fmtCost(d.cost) : '—'}</span>
      </div>
      {d.cost > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-2 py-2 text-[10px]">
            <div><div className="text-fg-faint">calls</div><div className="tnum text-fg">{fmtNum(d.calls)}</div></div>
            <div><div className="text-fg-faint">tokens</div><div className="tnum text-fg">{fmtTokens(d.tokens)}</div></div>
            <div><div className="text-fg-faint">saved</div><div className="tnum text-positive">{fmtCost(d.cacheSavings)}</div></div>
          </div>
          <div className="flex flex-col gap-1 border-t border-line-faint pt-2">
            {d.models.slice(0, 5).map(m => (
              <div key={m.name} className="flex items-center gap-2">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: modelColor(m.name) }} />
                <span className="min-w-0 flex-1 truncate text-fg-dim">{shortModel(m.name)}</span>
                <span className="tnum w-16 shrink-0 text-right text-fg">{fmtCost(m.cost)}</span>
              </div>
            ))}
            {d.models.length > 5 && <div className="pt-0.5 text-fg-faint">+{d.models.length - 5} more</div>}
          </div>
        </>
      ) : (
        <div className="pt-2 text-fg-faint">no spend this day</div>
      )}
    </div>
  )
}
