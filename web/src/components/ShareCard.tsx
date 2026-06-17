import { useEffect, useRef, useState } from 'react'
import type { Derived } from '../lib/derive'
import { fmtCost, fmtNum, fmtTokens } from '../lib/format'
import { shortModel } from '../lib/colors'
import { copyNode, downloadNode, shareFilename } from '../lib/share'
import { Check, Copy, Download, Share } from './icons'
import { Sparkline } from './ui'

export function ShareControl({ derived, periodLabel, tz, version }: {
  derived: Derived; periodLabel: string; tz: string; version: string
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onDownload = async () => { if (cardRef.current) await downloadNode(cardRef.current, shareFilename('summary'), { pixelRatio: 2 }); setOpen(false) }
  const onCopy = async () => {
    if (!cardRef.current) return
    const ok = await copyNode(cardRef.current, { pixelRatio: 2 })
    setCopied(ok); setTimeout(() => setCopied(false), 1400); setOpen(false)
  }

  const top = derived.byModel[0]

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2.5 py-1 text-xs text-fg-dim transition hover:border-accent/60 hover:text-accent"
        title="Create a shareable image"
      >
        {copied ? <Check className="size-3.5 text-positive" /> : <Share className="size-3.5" />}
        <span>{copied ? 'copied' : 'share'}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-44 rounded-md border border-line-2 bg-bg-2 p-1 shadow-xl">
          <MenuBtn onClick={onDownload}><Download className="size-3.5" /> Download PNG</MenuBtn>
          <MenuBtn onClick={onCopy}><Copy className="size-3.5" /> Copy to clipboard</MenuBtn>
        </div>
      )}

      <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none' }} aria-hidden>
        <div
          ref={cardRef}
          style={{
            width: 1040, height: 540, background: '#0a0d0e',
            backgroundImage: 'radial-gradient(circle at 50% -10%, rgba(0,215,255,0.10), transparent 55%), radial-gradient(#232c31 1px, transparent 1px)',
            backgroundSize: '100% 100%, 24px 24px',
            fontFamily: 'var(--font-mono)', color: '#cdd6d8',
          }}
          className="flex flex-col"
        >
          <div className="flex items-center gap-2 border-b border-line px-6 py-3.5">
            <span className="size-3 rounded-full" style={{ background: '#b45648' }} />
            <span className="size-3 rounded-full" style={{ background: '#c4ac62' }} />
            <span className="size-3 rounded-full" style={{ background: '#6caa71' }} />
            <span className="ml-3 text-sm text-fg-dim">tokmon — usage · last {periodLabel}</span>
            <span className="ml-auto text-xs text-fg-faint">{tz}</span>
          </div>

          <div className="flex flex-1 flex-col px-9 py-7">
            <div className="font-display text-xs uppercase tracking-widest text-fg-faint">total spend</div>
            <div className="tnum mt-1 text-7xl text-cost" style={{ lineHeight: 1 }}>{fmtCost(derived.totals.cost)}</div>

            <div className="mt-5">
              <Sparkline data={derived.timeline.map(t => t.total)} color="#7ccbcd" className="text-3xl" />
            </div>

            <div className="mt-auto grid grid-cols-4 gap-4 border-t border-line pt-5">
              <ShareStat label="tokens" value={fmtTokens(derived.totals.tokens)} />
              <ShareStat label="cache saved" value={fmtCost(derived.totals.cacheSavings)} color="#6caa71" />
              <ShareStat label="calls" value={fmtNum(derived.totals.calls)} />
              <ShareStat label="top model" value={top ? shortModel(top.model) : '—'} color={top?.color} />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-line px-9 py-3.5">
            <span className="font-display text-lg tracking-wide" style={{ color: '#f0f5f6' }}>TOKMON</span>
            <span className="text-xs text-fg-faint">github.com/DavidIlie/tokmon{version ? ` · v${version}` : ''}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ShareStat({ label, value, color = '#f0f5f6' }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="tnum mt-1 truncate text-xl" style={{ color }}>{value}</div>
    </div>
  )
}

function MenuBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-dim transition hover:bg-bg-3 hover:text-fg">
      {children}
    </button>
  )
}
