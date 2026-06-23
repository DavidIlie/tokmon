import { useState } from 'react'
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { Derived } from '../../lib/derive'
import { fmtCost, fmtCostAxis, fmtPct, fmtTokens, sumTokens } from '../../lib/format'
import { shortModel, TOKEN_BUCKET } from '../../lib/colors'
import { AXIS, ChartShell, GRID, singleTip, useEnterOnce, useMediaQuery } from '../chart'
import { Panel } from '../ui/panel'
import { EmptyHint } from '../ui/primitives'

const BAR_FILL = { fill: 'var(--color-bg-2)' }
const BAR_LABEL = { fill: 'var(--color-fg-dim)', fontSize: 10, fontFamily: 'var(--font-mono)' } as const

const modelTip = singleTip('cost', fmtCost, p => p[0]?.color, { title: l => shortModel(l) })
const tokensTip = singleTip('tokens', fmtTokens, p => p[0]?.color, { title: l => shortModel(l) })
const cacheTip = singleTip('saved', fmtCost, p => p[0]?.color, { title: l => shortModel(l) })

export function CostByModel({ derived, height = 280, limit = 10, metric = 'cost', periodLabel }: {
  derived: Derived
  height?: number
  limit?: number
  metric?: 'cost' | 'tokens'
  periodLabel?: string
}) {
  const enter = useEnterOnce()
  const wide = useMediaQuery('(min-width: 768px)')
  const yw = wide ? 124 : 92
  const rm = wide ? 60 : 44
  const isTokens = metric === 'tokens'
  const top = [...derived.byModel]
    .sort((a, b) => (isTokens ? b.tokens - a.tokens : b.cost - a.cost))
    .slice(0, limit)
  return (
    <Panel title={isTokens ? 'tokens by model' : 'cost by model'} titleTag={periodLabel} captureName={isTokens ? 'tokens-by-model' : 'cost-by-model'}>
      {top.length === 0 ? <EmptyHint>no models in period</EmptyHint> : (
        <ChartShell height={height}>
          <ResponsiveContainer>
            <BarChart data={top} layout="vertical" margin={{ top: 4, right: rm, left: 4, bottom: 0 }}>
              <CartesianGrid {...GRID} horizontal={false} vertical />
              <XAxis type="number" {...AXIS} tickFormatter={isTokens ? fmtTokens : fmtCostAxis} />
              <YAxis type="category" dataKey="model" {...AXIS} width={yw} tickFormatter={shortModel} />
              <Tooltip content={isTokens ? tokensTip : modelTip} cursor={BAR_FILL} />
              <Bar dataKey={isTokens ? 'tokens' : 'cost'} radius={[0, 3, 3, 0]} isAnimationActive={enter} animationDuration={350}>
                {top.map(m => <Cell key={m.model} fill={m.color} />)}
                <LabelList dataKey={isTokens ? 'tokens' : 'cost'} position="right" offset={6} {...BAR_LABEL}
                  formatter={(v: number) => (isTokens ? fmtTokens(v) : fmtCost(v))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>
      )}
    </Panel>
  )
}

export function CacheByModel({ derived, height = 240, limit = 12, periodLabel }: {
  derived: Derived
  height?: number
  limit?: number
  periodLabel?: string
}) {
  const enter = useEnterOnce()
  const wide = useMediaQuery('(min-width: 768px)')
  const yw = wide ? 124 : 92
  const rm = wide ? 60 : 44
  const top = [...derived.byModel]
    .filter(m => m.cacheSavings > 0)
    .sort((a, b) => b.cacheSavings - a.cacheSavings)
    .slice(0, limit)
  return (
    <Panel title="cache savings by model" titleTag={periodLabel} captureName="cache-savings-by-model">
      {top.length === 0 ? <EmptyHint>no cache savings in period</EmptyHint> : (
        <ChartShell height={height}>
          <ResponsiveContainer>
            <BarChart data={top} layout="vertical" margin={{ top: 4, right: rm, left: 4, bottom: 0 }}>
              <CartesianGrid {...GRID} horizontal={false} vertical />
              <XAxis type="number" {...AXIS} tickFormatter={fmtCostAxis} />
              <YAxis type="category" dataKey="model" {...AXIS} width={yw} tickFormatter={shortModel} />
              <Tooltip content={cacheTip} cursor={BAR_FILL} />
              <Bar dataKey="cacheSavings" radius={[0, 3, 3, 0]} fill="var(--color-positive)" isAnimationActive={enter} animationDuration={350}>
                <LabelList dataKey="cacheSavings" position="right" offset={6} {...BAR_LABEL} formatter={(v: number) => fmtCost(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>
      )}
    </Panel>
  )
}

export function ProviderDonut({ derived, height = 280, periodLabel }: { derived: Derived; height?: number; periodLabel?: string }) {
  const enter = useEnterOnce()
  const data = derived.byProvider
  const total = derived.totals.cost
  const [active, setActive] = useState<number | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const pinnedIdx = pinned ? data.findIndex(p => p.id === pinned) : -1
  const focusIdx = active != null ? active : (pinnedIdx >= 0 ? pinnedIdx : null)
  const focus = focusIdx != null ? data[focusIdx] : null
  const focusShare = focus && total > 0 ? focus.cost / total : 0
  return (
    <Panel title="provider split" titleTag={periodLabel} captureName="provider-split">
      {data.length === 0 ? <EmptyHint>no spend in period</EmptyHint> : (
        <div className="relative" onMouseLeave={() => setActive(null)}>
          <ChartShell height={height}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data} dataKey="cost" nameKey="name" innerRadius="60%" outerRadius="88%"
                  paddingAngle={data.length > 1 ? 2 : 0} stroke="var(--color-bg-1)" strokeWidth={2}
                  isAnimationActive={enter} animationDuration={350}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(_, i) => setActive(i)}
                  onClick={(_, i) => setPinned(p => (p === data[i]?.id ? null : data[i]?.id ?? null))}
                >
                  {data.map((p, i) => (
                    <Cell
                      key={p.id} fill={p.color}
                      aria-label={`${p.name}: ${fmtCost(p.cost)}`}
                      fillOpacity={focusIdx == null || focusIdx === i ? 1 : 0.32}
                      style={{ transition: 'fill-opacity 150ms ease' }}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </ChartShell>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="tnum text-xl" style={{ color: focus ? focus.color : 'var(--color-fg-bright)' }}>
              {fmtCost(focus ? focus.cost : total)}
            </div>
            <div className="font-display text-[10px] uppercase tracking-wide text-fg-faint">
              {focus ? `${focus.name} · ${fmtPct(focusShare, focusShare > 0 && focusShare < 0.01 ? 1 : 0)}` : 'total'}
              {focus && active == null && pinnedIdx >= 0 && <span className="text-accent"> · pinned</span>}
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

export function TokenComposition({ derived, periodLabel }: { derived: Derived; periodLabel?: string }) {
  const c = derived.tokenComposition
  const total = sumTokens(c)
  const rows = [
    { key: 'cacheRead', label: 'cache read', value: c.cacheRead, color: TOKEN_BUCKET.cacheRead },
    { key: 'input', label: 'input', value: c.input, color: TOKEN_BUCKET.input },
    { key: 'output', label: 'output', value: c.output, color: TOKEN_BUCKET.output },
    { key: 'cacheCreate', label: 'cache write', value: c.cacheCreate, color: TOKEN_BUCKET.cacheCreate },
  ]
  return (
    <Panel title="token composition" titleTag={periodLabel} captureName="token-composition" right={<span className="tnum text-xs text-fg-dim">{fmtTokens(total)}</span>}>
      {total === 0 ? <EmptyHint>no tokens in period</EmptyHint> : (
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-bg-3">
            {rows.map(r => r.value > 0 && (
              <div key={r.key} style={{ width: `${(r.value / total) * 100}%`, minWidth: '2px', background: r.color }} title={`${r.label}: ${fmtTokens(r.value)}`} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            {rows.map(r => {
              const share = total > 0 ? r.value / total : 0
              return (
                <div key={r.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-fg-dim">
                    <span className="inline-block size-2 rounded-[2px]" style={{ background: r.color }} />
                    {r.label}
                  </span>
                  <span className="text-fg">
                    <span className="tnum text-fg-bright">{fmtTokens(r.value)}</span>
                    <span className="ml-1.5 text-fg-faint">{fmtPct(share, share > 0 && share < 0.01 ? 1 : 0)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Panel>
  )
}
