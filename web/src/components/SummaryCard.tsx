import { forwardRef } from 'react'
import type { Derived } from '../lib/derive'
import { fmtCost, fmtNum, fmtTokens } from '../lib/format'
import { shortModel } from '../lib/colors'
import { Sparkline } from './ui'
import { Watermark } from './Watermark'

export interface SummaryOpts {
  glow: boolean
  wmPos: 'footer' | 'corner'
}

// The curated 1040×540 share card — composed from scratch (no live chrome), all
// token-driven so it captures correctly in either pinned theme.
export const SummaryCard = forwardRef<HTMLDivElement, {
  derived: Derived
  periodLabel: string
  tz: string
  version: string
  opts: SummaryOpts
}>(function SummaryCard({ derived, periodLabel, tz, version, opts }, ref) {
  const top = derived.byModel[0]
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
      <div className="flex items-center gap-2 border-b border-line px-6 py-3.5">
        <span className="size-3 rounded-full bg-warning" />
        <span className="size-3 rounded-full bg-cost" />
        <span className="size-3 rounded-full bg-positive" />
        <span className="ml-3 text-sm text-fg-dim">tokmon — usage · last {periodLabel}</span>
        <span className="ml-auto text-xs text-fg-faint">{tz}</span>
      </div>

      <div className="flex flex-1 flex-col px-9 py-7">
        <div className="font-display text-xs uppercase tracking-widest text-fg-faint">total spend</div>
        <div className="tnum mt-1 text-cost" style={{ fontSize: 72, lineHeight: 1 }}>{fmtCost(derived.totals.cost)}</div>
        <div className="mt-5">
          <Sparkline data={derived.timeline.map(t => t.total)} color="var(--color-accent)" className="text-3xl" />
        </div>
        <div className="mt-auto grid grid-cols-4 gap-4 border-t border-line pt-5">
          <ShareStat label="tokens" value={fmtTokens(derived.totals.tokens)} />
          <ShareStat label="cache saved" value={fmtCost(derived.totals.cacheSavings)} className="text-positive" />
          <ShareStat label="calls" value={fmtNum(derived.totals.calls)} />
          <ShareStat label="top model" value={top ? shortModel(top.model) : '—'} />
        </div>
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
