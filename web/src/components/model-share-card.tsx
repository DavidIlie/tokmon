import { forwardRef } from 'react'
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { ShareSource } from './share-provider'
import { fmtCost, fmtCostAxis, fmtCount, fmtDayLabel, fmtTokens, sumTokens } from '../lib/format'
import { modelColor, shortModel, TOKEN_BUCKET } from '../lib/colors'
import { GRID } from './chart'
import { Watermark } from './watermark'

export interface ModelShareOpts {
  glow: boolean
  wmPos: 'footer' | 'corner'
}

type ModelSource = Extract<ShareSource, { kind: 'model' }>

const accountLabel = (row: ModelSource['accounts'][number]) =>
  row.name && row.name !== row.provider ? `${row.provider} · ${row.name}` : row.provider

export const ModelShareCard = forwardRef<HTMLDivElement, {
  source: ModelSource
  opts: ModelShareOpts
}>(function ModelShareCard({ source, opts }, ref) {
  const color = modelColor(source.model)
  const totalTokens = sumTokens(source.totals)
  const accountRows = compactAccounts(source.accounts)
  const maxCost = Math.max(...source.daily.map(d => d.cost), 0)

  return (
    <div
      ref={ref}
      className="relative flex flex-col overflow-hidden"
      style={{
        width: 900, height: 540,
        background: 'var(--color-bg-0)',
        backgroundImage: opts.glow
          ? `radial-gradient(circle at 42% -12%, color-mix(in oklab, ${color} 18%, transparent), transparent 58%), radial-gradient(var(--color-line-faint) 1px, transparent 1px)`
          : 'radial-gradient(var(--color-line-faint) 1px, transparent 1px)',
        backgroundSize: opts.glow ? '100% 100%, 24px 24px' : '24px 24px',
        fontFamily: 'var(--font-mono)', color: 'var(--color-fg)',
      }}
    >
      <div className="flex items-baseline gap-2 border-b border-line px-6 py-3.5">
        <span className="font-display text-sm tracking-wide text-accent">tokmon</span>
        <span className="text-sm text-fg-dim">model spotlight · {source.periodLabel}</span>
        <span className="ml-auto text-xs text-fg-faint">{source.tz}</span>
      </div>

      <div className="grid flex-1 grid-cols-[340px_1fr] gap-7 px-8 py-6">
        <section className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
            <span className="font-display text-xs uppercase tracking-widest text-fg-faint">model</span>
          </div>
          <div className="mt-3 min-h-[132px]">
            <div className="break-words font-display text-[46px] leading-[0.98]" style={{ color }}>
              {shortModel(source.model)}
            </div>
            <div className="mt-2 truncate text-xs text-fg-faint" title={source.model}>{source.model}</div>
          </div>

          <div className="mt-auto grid grid-cols-2 gap-x-5 gap-y-4">
            <HeroStat label="spend" value={fmtCost(source.totals.cost)} className="text-cost" />
            <HeroStat label="tokens" value={fmtTokens(totalTokens)} />
            <HeroStat label="calls" value={fmtCount(source.totals.count)} />
            <HeroStat label="accounts" value={fmtCount(source.accounts.length)} />
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-4 border-l border-line pl-7">
          <div className="grid grid-cols-4 gap-2">
            <TokenStat label="input" value={source.totals.input} color={TOKEN_BUCKET.input} />
            <TokenStat label="output" value={source.totals.output} color={TOKEN_BUCKET.output} />
            <TokenStat label="cache create" value={source.totals.cacheCreate} color={TOKEN_BUCKET.cacheCreate} />
            <TokenStat label="cache read" value={source.totals.cacheRead} color={TOKEN_BUCKET.cacheRead} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-xs uppercase tracking-widest text-fg-faint">account split</span>
              <span className="tnum text-xs text-fg-faint">{fmtCost(source.totals.cost)}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {accountRows.length === 0 ? (
                <div className="rounded border border-line bg-bg-1 px-3 py-5 text-center text-xs text-fg-faint">no usage in range</div>
              ) : accountRows.map(row => {
                const share = source.totals.cost > 0 ? (row.cost / source.totals.cost) * 100 : 0
                return (
                  <div key={`${row.providerId}:${row.name}`} className="grid grid-cols-[minmax(0,1fr)_76px_78px] items-center gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: row.color }} />
                      <span className="truncate text-fg-dim" title={row.providerId === 'other' ? row.name : accountLabel(row)}>{row.providerId === 'other' ? row.name : accountLabel(row)}</span>
                    </span>
                    <span className="tnum text-right text-cost">{fmtCost(row.cost)}</span>
                    <span className="tnum text-right text-fg-faint">{fmtTokens(row.tokens)}</span>
                    <span className="col-span-3 h-1 overflow-hidden rounded-full bg-bg-3">
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, minWidth: row.cost > 0 ? 2 : 0, background: row.color }} />
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-auto">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-display text-xs uppercase tracking-widest text-fg-faint">daily cost</span>
              <span className="tnum text-xs text-fg-faint">peak {fmtCost(maxCost)}</span>
            </div>
            <div className="h-[118px] rounded border border-line bg-bg-1/50 px-2 py-2">
              {source.daily.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-fg-faint">no daily usage</div>
              ) : (
                <ResponsiveContainer>
                  <ComposedChart data={source.daily} margin={{ top: 8, right: 10, left: 2, bottom: 0 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="day" tick={{ fill: 'var(--color-fg-faint)', fontSize: 9, fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} minTickGap={22} tickFormatter={fmtDayLabel} />
                    <YAxis hide tickFormatter={fmtCostAxis} domain={[0, 'dataMax']} />
                    <Area type="monotone" dataKey="cost" stroke={color} fill={color} fillOpacity={0.14} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Bar dataKey="cost" fill={color} opacity={0.38} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between border-t border-line px-8 py-3.5">
        {opts.wmPos === 'footer' ? <Watermark variant="footer" version={source.version} /> : <span className="text-xs text-fg-faint">tokmon</span>}
        <span className="text-xs text-fg-faint">{source.periodLabel}</span>
      </div>
      {opts.wmPos === 'corner' && <Watermark variant="corner" />}
    </div>
  )
})

function HeroStat({ label, value, className = 'text-fg-bright' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="font-display text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`tnum mt-1 truncate text-2xl ${className}`}>{value}</div>
    </div>
  )
}

function TokenStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="min-w-0 rounded border border-line bg-bg-1 px-2 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-faint">
        <span className="size-1.5 shrink-0 rounded-[2px]" style={{ background: color }} />
        <span className="truncate">{label}</span>
      </div>
      <div className="tnum mt-1 truncate text-sm text-fg-bright">{fmtTokens(value)}</div>
    </div>
  )
}

function compactAccounts(accounts: ModelSource['accounts']): ModelSource['accounts'] {
  if (accounts.length <= 6) return accounts
  const visible = accounts.slice(0, 5)
  const rest = accounts.slice(5)
  const other = rest.reduce((row, acc) => ({
    ...row,
    tokens: row.tokens + acc.tokens,
    cost: row.cost + acc.cost,
  }), {
    name: `${rest.length} more accounts`,
    color: 'var(--color-fg-faint)',
    provider: 'Other',
    providerId: 'other',
    tokens: 0,
    cost: 0,
  })
  return [...visible, other]
}
