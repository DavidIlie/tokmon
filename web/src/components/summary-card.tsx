import { forwardRef } from 'react'
import type { Derived } from '../lib/derive'
import { fmtCost, fmtNum, fmtPct, fmtTokens } from '../lib/format'
import { shortModel } from '../lib/colors'
import { Sparkline } from './ui/primitives'
import { Watermark } from './watermark'

const scopeLabel = (p: string) => (p === 'all time' ? 'all time' : `last ${p}`)

export interface SummaryOpts {
  glow: boolean
  wmPos: 'footer' | 'corner'
}

export const SummaryCard = forwardRef<HTMLDivElement, {
  derived: Derived
  periodLabel: string
  tz: string
  version: string
  opts: SummaryOpts
}>(function SummaryCard({ derived, periodLabel, tz, version, opts }, ref) {
  const models = derived.byModel.slice(0, 5)
  const costLed = derived.totals.cost > 0
  const shareOf = (m: typeof models[number]) => (costLed ? m.share : m.tokenShare)
  return (
    <div
      ref={ref}
      className="relative flex flex-col"
      style={{
        width: 1040, height: 540,
        background: 'var(--color-bg-0)',
        backgroundImage: opts.glow
          ? 'radial-gradient(circle at 50% -10%, color-mix(in oklab, var(--color-accent) 16%, transparent), transparent 55%), radial-gradient(var(--color-line-faint) 1px, transparent 1px)'
          : 'radial-gradient(var(--color-line-faint) 1px, transparent 1px)',
        backgroundSize: opts.glow ? '100% 100%, 24px 24px' : '24px 24px',
        fontFamily: 'var(--font-mono)', color: 'var(--color-fg)',
      }}
    >
      <div className="flex items-baseline gap-2 border-b border-line px-6 py-3.5">
        <span className="font-display text-sm tracking-wide text-accent">tokmon</span>
        <span className="text-sm text-fg-dim">usage · {scopeLabel(periodLabel)}</span>
        <span className="ml-auto text-xs text-fg-faint">{tz}</span>
      </div>

      <div className="flex flex-1 gap-9 px-9 py-7">
        <div className="flex w-[300px] shrink-0 flex-col">
          <div className="font-display text-xs uppercase tracking-widest text-fg-faint">{costLed ? 'total spend' : 'total tokens'}</div>
          <div className="tnum mt-1 text-cost" style={{ fontSize: 64, lineHeight: 1 }}>
            {costLed ? fmtCost(derived.totals.cost) : fmtTokens(derived.totals.tokens)}
          </div>
          <div className="mt-auto flex flex-col gap-3">
            {costLed
              ? <ShareStat label="tokens" value={fmtTokens(derived.totals.tokens)} />
              : <ShareStat label="spend" value={fmtCost(derived.totals.cost)} />}
            <ShareStat label="cache saved" value={fmtCost(derived.totals.cacheSavings)} className="text-positive" />
            <ShareStat label="calls" value={fmtNum(derived.totals.calls)} />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 border-l border-line pl-9">
          <div className="font-display text-xs uppercase tracking-widest text-fg-faint">top models · {scopeLabel(periodLabel)}</div>
          {models.length === 0
            ? <div className="flex flex-1 items-center text-sm text-fg-faint">no model usage in range</div>
            : models.map(m => (
              <div key={m.model} className="flex items-center gap-3">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: m.color }} />
                <span className="w-28 shrink-0 truncate text-sm text-fg">{shortModel(m.model)}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-3">
                  <span className="block h-full rounded-full" style={{ width: `${Math.min(100, shareOf(m) * 100)}%`, minWidth: 2, background: m.color }} />
                </span>
                <span className="tnum w-10 shrink-0 text-right text-xs text-fg-faint">{fmtPct(shareOf(m))}</span>
                <span className="tnum w-20 shrink-0 text-right text-sm text-cost">{costLed ? fmtCost(m.cost) : fmtTokens(m.tokens)}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="border-t border-line px-9 pt-3">
        <Sparkline data={derived.timeline.map(t => t.total)} color="var(--color-accent)" className="text-2xl tracking-tight" />
      </div>

      <div className="flex items-center justify-between border-t border-line px-9 py-3.5">
        {opts.wmPos === 'footer' ? <Watermark variant="footer" version={version} /> : <span className="text-xs text-fg-faint">tokmon</span>}
        <span className="text-xs text-fg-faint">{periodLabel}</span>
      </div>
      {opts.wmPos === 'corner' && <Watermark variant="corner" />}
    </div>
  )
})

function ShareStat({ label, value, className = 'text-fg-bright' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`tnum mt-1 truncate text-xl ${className}`}>{value}</div>
    </div>
  )
}
