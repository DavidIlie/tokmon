import { useMemo } from 'react'
import type { Derived } from '../../lib/derive'
import { fmtCost, fmtDayLabel } from '../../lib/format'
import { Panel } from '../ui'

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// UTC-safe date helpers — avoids local-timezone shifts on parsed date strings.
const parseDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)
// Monday = 0, Sunday = 6 (ISO week order for the grid rows).
const dowMonday = (ms: number) => (new Date(ms).getUTCDay() + 6) % 7

const HEAT_OPACITY = [0, 0.32, 0.55, 0.78, 1]
const heatFill = (level: number) => {
  if (level === 0) return 'var(--color-bg-2)'
  return `color-mix(in oklab, var(--color-cost) ${HEAT_OPACITY[level] * 100}%, var(--color-bg-2))`
}

interface Cell { date: string; cost: number; level: number }

export function CalendarHeatmap({ derived, maxWeeks = 26 }: { derived: Derived; maxWeeks?: number }) {
  const grid = useMemo(() => {
    const map = new Map(derived.calendar.map(c => [c.date, c.cost]))
    if (derived.calendar.length === 0) return null
    const last = derived.calendar[derived.calendar.length - 1].date
    const firstData = derived.rangeStart ?? derived.calendar[0].date
    let endMs = parseDate(last)
    let startMs = parseDate(firstData)
    if ((endMs - startMs) / (DAY * 7) > maxWeeks) startMs = endMs - maxWeeks * 7 * DAY
    // Align start to Monday so each column is a full ISO week.
    startMs -= dowMonday(startMs) * DAY
    const max = Math.max(...derived.calendar.map(c => c.cost), 0)
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

  return (
    <Panel title="daily spend" captureName="calendar">
      {!grid ? <div className="py-6 text-center text-xs text-fg-faint">no spend in range</div> : (
        <div className="flex flex-col gap-1.5 overflow-x-auto pt-1">
          <div className="flex gap-[3px] pl-6 text-[9px] text-fg-faint">
            {grid.weeks.map((_, i) => {
              const m = grid.monthLabels.find(l => l.col === i)
              return <div key={i} className="w-[13px] shrink-0">{m?.text ?? ''}</div>
            })}
          </div>
          <div className="flex gap-[3px]">
            <div className="flex w-5 shrink-0 flex-col gap-[3px] text-[9px] leading-[13px] text-fg-faint">
              {['M', '', 'W', '', 'F', '', ''].map((d, i) => <div key={i} className="h-[13px]">{d}</div>)}
            </div>
            {grid.weeks.map((week, wi) => (
              <div key={wi} className="flex shrink-0 flex-col gap-[3px]">
                {week.map((cell, di) => cell === null
                  ? <div key={di} className="size-[13px]" />
                  : (
                    <div
                      key={di}
                      className="size-[13px] rounded-[3px] transition hover:ring-1 hover:ring-accent"
                      style={{ background: heatFill(cell.level) }}
                      title={`${fmtDayLabel(cell.date)} · ${fmtCost(cell.cost)}`}
                    />
                  ))}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 pl-6 pt-1 text-[9px] text-fg-faint">
            less
            {[0, 1, 2, 3, 4].map(l => <span key={l} className="size-[11px] rounded-[2px]" style={{ background: heatFill(l) }} />)}
            more
          </div>
        </div>
      )}
    </Panel>
  )
}
