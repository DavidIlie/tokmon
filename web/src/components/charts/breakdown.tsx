import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { Derived } from '../../lib/derive'
import { fmtCost, fmtCostAxis, fmtPct, fmtTokens } from '../../lib/format'
import { shortModel, TOKEN_BUCKET } from '../../lib/colors'
import { AXIS, ChartShell, GRID, makeTooltip } from '../chart'
import { EmptyHint, Panel } from '../ui'

const BAR_FILL = { fill: 'var(--color-bg-2)' }

const modelTip = makeTooltip(
  p => [{ label: 'cost', value: fmtCost(p[0]?.value ?? 0), color: p[0]?.color }],
  { title: l => shortModel(l) },
)
const tokensTip = makeTooltip(
  p => [{ label: 'tokens', value: fmtTokens(p[0]?.value ?? 0), color: p[0]?.color }],
  { title: l => shortModel(l) },
)
const cacheTip = makeTooltip(
  p => [{ label: 'saved', value: fmtCost(p[0]?.value ?? 0), color: p[0]?.color }],
  { title: l => shortModel(l) },
)

export function CostByModel({ derived, height = 280, limit = 10, metric = 'cost' }: {
  derived: Derived
  height?: number
  limit?: number
  metric?: 'cost' | 'tokens'
}) {
  const isTokens = metric === 'tokens'
  const top = [...derived.byModel]
    .sort((a, b) => (isTokens ? b.tokens - a.tokens : b.cost - a.cost))
    .slice(0, limit)
  return (
    <Panel title={isTokens ? 'tokens by model' : 'cost by model'} captureName={isTokens ? 'tokens-by-model' : 'cost-by-model'}>
      {top.length === 0 ? <EmptyHint>no models in range</EmptyHint> : (
        <ChartShell height={height}>
          <ResponsiveContainer>
            <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid {...GRID} horizontal={false} vertical />
              <XAxis type="number" {...AXIS} tickFormatter={isTokens ? fmtTokens : fmtCostAxis} />
              <YAxis type="category" dataKey="model" {...AXIS} width={124} tickFormatter={shortModel} />
              <Tooltip content={isTokens ? tokensTip : modelTip} cursor={BAR_FILL} />
              <Bar dataKey={isTokens ? 'tokens' : 'cost'} radius={[0, 3, 3, 0]} isAnimationActive animationDuration={350}>
                {top.map(m => <Cell key={m.model} fill={m.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>
      )}
    </Panel>
  )
}

export function CacheByModel({ derived, height = 240, limit = 12 }: {
  derived: Derived
  height?: number
  limit?: number
}) {
  const top = [...derived.byModel]
    .filter(m => m.cacheSavings > 0)
    .sort((a, b) => b.cacheSavings - a.cacheSavings)
    .slice(0, limit)
  return (
    <Panel title="cache savings by model" captureName="cache-savings-by-model">
      {top.length === 0 ? <EmptyHint>no cache savings in range</EmptyHint> : (
        <ChartShell height={height}>
          <ResponsiveContainer>
            <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid {...GRID} horizontal={false} vertical />
              <XAxis type="number" {...AXIS} tickFormatter={fmtCostAxis} />
              <YAxis type="category" dataKey="model" {...AXIS} width={124} tickFormatter={shortModel} />
              <Tooltip content={cacheTip} cursor={BAR_FILL} />
              <Bar dataKey="cacheSavings" radius={[0, 3, 3, 0]} fill="var(--color-positive)" isAnimationActive animationDuration={350} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>
      )}
    </Panel>
  )
}

const provTip = makeTooltip(
  p => {
    const row = p[0]
    const d = row?.payload as { cost?: number } | undefined
    return [{ label: 'cost', value: fmtCost(d?.cost ?? row?.value ?? 0), color: row?.color }]
  },
  { title: l => l },
)

export function ProviderDonut({ derived, height = 280 }: { derived: Derived; height?: number }) {
  const data = derived.byProvider
  const total = derived.totals.cost
  return (
    <Panel title="provider split" captureName="provider-split">
      {data.length === 0 ? <EmptyHint>no spend in range</EmptyHint> : (
        <div className="relative">
          <ChartShell height={height}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data} dataKey="cost" nameKey="name" innerRadius="60%" outerRadius="88%"
                  paddingAngle={data.length > 1 ? 2 : 0} stroke="var(--color-bg-1)" strokeWidth={2}
                  isAnimationActive animationDuration={350}
                >
                  {data.map(p => <Cell key={p.id} fill={p.color} />)}
                </Pie>
                <Tooltip content={provTip} offset={16} allowEscapeViewBox={{ x: true, y: true }} wrapperStyle={{ pointerEvents: 'none', zIndex: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartShell>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="tnum text-xl text-fg-bright">{fmtCost(total)}</div>
            <div className="font-display text-[10px] uppercase tracking-wide text-fg-faint">total</div>
          </div>
        </div>
      )}
    </Panel>
  )
}

export function TokenComposition({ derived }: { derived: Derived }) {
  const c = derived.tokenComposition
  const total = c.input + c.output + c.cacheCreate + c.cacheRead
  const rows = [
    { key: 'cacheRead', label: 'cache read', value: c.cacheRead, color: TOKEN_BUCKET.cacheRead },
    { key: 'input', label: 'input', value: c.input, color: TOKEN_BUCKET.input },
    { key: 'output', label: 'output', value: c.output, color: TOKEN_BUCKET.output },
    { key: 'cacheCreate', label: 'cache write', value: c.cacheCreate, color: TOKEN_BUCKET.cacheCreate },
  ]
  return (
    <Panel title="token composition" captureName="token-composition" right={<span className="tnum text-xs text-fg-dim">{fmtTokens(total)}</span>}>
      {total === 0 ? <EmptyHint>no tokens in range</EmptyHint> : (
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
