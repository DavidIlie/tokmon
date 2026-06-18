import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Derived } from '../../lib/derive'
import { fmtCost, fmtCostAxis, fmtDayLabel } from '../../lib/format'
import { AXIS, ChartShell, CURSOR, GRID, makeTooltip, useEnterOnce } from '../chart'
import { EmptyHint, Panel, Segmented } from '../ui'

type Scale = 'linear' | 'log'
type Mode = 'combined' | 'byProvider'

const SCALE_OPTIONS: { value: Scale; label: string }[] = [
  { value: 'linear', label: 'lin' },
  { value: 'log', label: 'log' },
]
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'combined', label: 'merged' },
  { value: 'byProvider', label: 'split' },
]
const segBox = 'flex items-center overflow-hidden rounded border border-line text-[10px]'

const costTip = makeTooltip(payload => {
  const rows = payload
    .filter(p => p.dataKey !== 'total' && (p.value ?? 0) > 0)
    .map(p => ({ label: String(p.name ?? p.dataKey), value: fmtCost(p.value ?? 0), color: p.color }))
  const total = payload.reduce((s, p) => s + (p.dataKey === 'total' ? 0 : p.value ?? 0), 0)
  if (rows.length > 1) rows.push({ label: 'total', value: fmtCost(total), color: 'var(--color-fg-bright)' })
  return rows
})
const totalTip = makeTooltip(p => [{ label: 'total', value: fmtCost(p[0]?.value ?? 0), color: 'var(--color-cost)' }])

export function CostTimeline({ derived, title = 'cost over time', height = 260, periodLabel, heightClass }: {
  derived: Derived
  title?: string
  height?: number
  periodLabel?: string
  heightClass?: string
}) {
  const enter = useEnterOnce()
  const provs = derived.byProvider
  const multiProvider = provs.length > 1
  const [scale, setScale] = useState<Scale>('linear')
  const [mode, setMode] = useState<Mode>(multiProvider ? 'byProvider' : 'combined')

  const data = derived.timeline.map(p => {
    const row: Record<string, number | string | null> = { date: p.date, total: p.total, ...p.byProvider }
    // Log scale can't plot 0 — null lets connectNulls bridge the gap cleanly.
    if (scale === 'log') for (const k of Object.keys(row)) if (k !== 'date' && row[k] === 0) row[k] = null
    return row
  })

  const yAxis = (
    <YAxis
      {...AXIS} width={52} tickFormatter={fmtCostAxis}
      scale={scale} allowDataOverflow={scale === 'log'}
      domain={scale === 'log' ? [0.1, 'auto'] : [0, 'auto']}
    />
  )

  return (
    <Panel
      title={title}
      titleTag={periodLabel}
      captureName="cost-over-time"
      right={
        <div className="flex items-center gap-1.5">
          {multiProvider && <Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} size="xs" containerClassName={segBox} ariaLabel="combine providers" />}
          <Segmented options={SCALE_OPTIONS} value={scale} onChange={setScale} size="xs" containerClassName={segBox} ariaLabel="value scale" />
        </div>
      }
    >
      {data.length === 0 ? <EmptyHint>no spend in period</EmptyHint> : (
        <ChartShell height={height} heightClass={heightClass}>
          <ResponsiveContainer>
            {mode === 'combined' ? (
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="g-cost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-cost)" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="var(--color-cost)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} tickFormatter={fmtDayLabel} minTickGap={28} />
                {yAxis}
                <Tooltip content={totalTip} cursor={CURSOR} />
                <Area type="monotone" dataKey="total" stroke="var(--color-cost)" strokeWidth={1.8} fill="url(#g-cost)" connectNulls isAnimationActive={enter} animationDuration={350} />
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} tickFormatter={fmtDayLabel} minTickGap={28} />
                {yAxis}
                <Tooltip content={costTip} cursor={CURSOR} />
                {provs.map(p => (
                  <Line
                    key={p.id} type="monotone" dataKey={p.id} name={p.name}
                    stroke={p.color} strokeWidth={1.6} dot={false} connectNulls
                    isAnimationActive={enter} animationDuration={350}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </ChartShell>
      )}
    </Panel>
  )
}

const cumTip = makeTooltip(p => [{ label: 'cumulative', value: fmtCost(p[0]?.value ?? 0), color: 'var(--color-cost)' }])

export function CumulativeSpend({ derived, height = 220, periodLabel }: { derived: Derived; height?: number; periodLabel?: string }) {
  const enter = useEnterOnce()
  const data = derived.cumulative
  return (
    <Panel title="cumulative spend" titleTag={periodLabel} captureName="cumulative">
      {data.length === 0 ? <EmptyHint>no spend in period</EmptyHint> : (
        <ChartShell height={height}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="date" {...AXIS} tickFormatter={fmtDayLabel} minTickGap={28} />
              <YAxis {...AXIS} width={52} tickFormatter={fmtCostAxis} />
              <Tooltip content={cumTip} cursor={CURSOR} />
              <Line type="monotone" dataKey="total" stroke="var(--color-cost)" strokeWidth={1.8} dot={false} isAnimationActive={enter} animationDuration={350} />
            </LineChart>
          </ResponsiveContainer>
        </ChartShell>
      )}
    </Panel>
  )
}

const saveTip = makeTooltip(p => [{ label: 'cache saved', value: fmtCost(p[0]?.value ?? 0), color: 'var(--color-positive)' }])

export function CacheSavings({ derived, height = 220, periodLabel }: { derived: Derived; height?: number; periodLabel?: string }) {
  const enter = useEnterOnce()
  const data = derived.cacheSavingsSeries
  const total = derived.totals.cacheSavings
  return (
    <Panel title="cache savings" titleTag={periodLabel} captureName="cache-savings" right={<span className="tnum text-xs text-positive">{fmtCost(total)}</span>}>
      {data.length === 0 ? <EmptyHint>no cache reads in period</EmptyHint> : (
        <ChartShell height={height}>
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="g-save" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-positive)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--color-positive)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="date" {...AXIS} tickFormatter={fmtDayLabel} minTickGap={28} />
              <YAxis {...AXIS} width={52} tickFormatter={fmtCostAxis} />
              <Tooltip content={saveTip} cursor={CURSOR} />
              <Area type="monotone" dataKey="value" stroke="var(--color-positive)" strokeWidth={1.6} fill="url(#g-save)" isAnimationActive={enter} animationDuration={350} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartShell>
      )}
    </Panel>
  )
}
