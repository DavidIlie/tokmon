import { useEffect, useRef, useState, type ReactNode } from 'react'
import { copyNode, downloadNode, shareFilename } from '../lib/share'
import { Check, Copy, Download, X } from './icons'
import { Segmented } from './ui/controls'
import { SummaryCard } from './summary-card'
import { ModelShareCard } from './model-share-card'
import { CaptureFrame } from './capture-frame'
import type { ShareSource } from './share-provider'
import { useDialogTrap } from './settings/use-dialog-trap'

type Theme = 'dark' | 'light'
type WmPos = 'footer' | 'corner'
const STAGE_W = 600
const STAGE_H = 360
const bgFor = (t: Theme) => (t === 'light' ? '#f4f5f5' : '#0a0a0a')
const modelSlug = (model: string) => model.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'model'

export function ShareSheet({ source, onClose }: { source: ShareSource; onClose: () => void }) {
  const isSummary = source.kind === 'summary'
  const isModel = source.kind === 'model'
  const isCard = isSummary || isModel
  const exportRef = useRef<HTMLDivElement>(null)
  const dlRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const doneTimer = useRef<ReturnType<typeof setTimeout>>()

  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains('light') ? 'light' : 'dark'))
  const [wmPos, setWmPos] = useState<WmPos>(isCard ? 'footer' : 'corner')
  const [scale, setScale] = useState<'1' | '2' | '3'>('2')
  const [glow, setGlow] = useState(true)
  const [framed, setFramed] = useState(true)
  const [dims, setDims] = useState({ w: isSummary ? 1040 : isModel ? 900 : 700, h: isCard ? 540 : 360 })
  const [done, setDone] = useState<'dl' | 'copy' | 'fail' | null>(null)
  const [busy, setBusy] = useState<'download' | 'copy' | null>(null)

  useDialogTrap(panelRef, { active: true, onEscape: onClose, initialFocusRef: dlRef })

  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current) }, [])
  const flash = (kind: 'dl' | 'copy' | 'fail') => {
    setDone(kind)
    if (doneTimer.current) clearTimeout(doneTimer.current)
    doneTimer.current = setTimeout(() => setDone(null), 1600)
  }

  useEffect(() => {
    const el = exportRef.current
    if (!el) return
    const measure = () => setDims(current => ({
      w: el.offsetWidth || current.w,
      h: el.offsetHeight || current.h,
    }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const t = setTimeout(measure, 80)
    return () => { ro.disconnect(); clearTimeout(t) }
  }, [source, framed, wmPos, theme, glow])

  const k = Math.min(STAGE_W / dims.w, STAGE_H / dims.h, 1)
  const opts = { pixelRatio: Number(scale), backgroundColor: bgFor(theme) }
  const filename = shareFilename(isSummary ? 'summary' : isModel ? `model-${modelSlug(source.model)}` : source.captureName)

  const onDownload = async () => {
    if (!exportRef.current || busy) return
    setBusy('download')
    try {
      await downloadNode(exportRef.current, filename, opts)
      flash('dl')
    } catch {
      flash('fail')
    } finally {
      setBusy(null)
    }
  }
  const onCopy = async () => {
    if (!exportRef.current || busy) return
    setBusy('copy')
    try {
      flash((await copyNode(exportRef.current, opts)) ? 'copy' : 'fail')
    } finally {
      setBusy(null)
    }
  }

  const status = busy === 'download' ? 'Creating PNG…'
    : busy === 'copy' ? 'Copying image…'
    : done === 'dl' ? 'PNG downloaded.'
    : done === 'copy' ? 'Image copied.'
    : done === 'fail' ? 'Image export failed. Try downloading instead.'
    : ''

  return (
    <div
      className="dialog-fade fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto overscroll-contain bg-bg-0/70 p-4 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
    >
      <div ref={panelRef} tabIndex={-1} className="dialog-pop relative flex max-h-[88vh] w-full max-w-[720px] flex-col overflow-hidden rounded-md border border-line-2 bg-bg-1 focus:outline-none">
        <h2 id="share-title" className="pointer-events-none absolute left-3 top-2 font-display text-[11px] uppercase tracking-wider text-fg-dim">share</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-2 top-2 z-10 rounded p-1 text-fg-faint transition hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
          <X className="size-4" />
        </button>

        <div className="flex items-center justify-center bg-bg-0 px-6 pb-5 pt-9" style={{ minHeight: STAGE_H + 24 }}>
          <div className="overflow-hidden rounded" style={{ width: dims.w * k, height: dims.h * k }}>
            <div style={{ width: dims.w, height: dims.h, transform: `scale(${k})`, transformOrigin: 'top left' }}>
              <div className={theme === 'light' ? 'light' : 'dark'}>
                {isSummary ? (
                  <SummaryCard ref={exportRef} derived={source.derived} periodLabel={source.periodLabel} tz={source.tz} version={source.version} opts={{ glow, wmPos }} />
                ) : isModel ? (
                  <ModelShareCard ref={exportRef} source={source} opts={{ glow, wmPos }} />
                ) : (
                  <CaptureFrame ref={exportRef} node={source.node} title={source.captureName} framed={framed} wmPos={wmPos} />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 text-[11px]">
          <Chip label="theme">
            <Segmented<Theme> size="xs" containerClassName={SEG} ariaLabel="export theme" options={[{ value: 'dark', label: 'dark' }, { value: 'light', label: 'light' }]} value={theme} onChange={setTheme} />
          </Chip>
          <Chip label="mark">
            <Segmented<WmPos> size="xs" containerClassName={SEG} ariaLabel="watermark position" options={[{ value: 'footer', label: 'footer' }, { value: 'corner', label: 'corner' }]} value={wmPos} onChange={setWmPos} />
          </Chip>
          {isCard ? (
            <Chip label="glow">
              <Segmented<'on' | 'off'> size="xs" containerClassName={SEG} ariaLabel="accent glow" options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]} value={glow ? 'on' : 'off'} onChange={v => setGlow(v === 'on')} />
            </Chip>
          ) : (
            <Chip label="frame">
              <Segmented<'framed' | 'bare'> size="xs" containerClassName={SEG} ariaLabel="frame" options={[{ value: 'framed', label: 'framed' }, { value: 'bare', label: 'bare' }]} value={framed ? 'framed' : 'bare'} onChange={v => setFramed(v === 'framed')} />
            </Chip>
          )}
          <Chip label="scale">
            <Segmented<'1' | '2' | '3'> size="xs" containerClassName={SEG} ariaLabel="export scale" options={[{ value: '1', label: '1x' }, { value: '2', label: '2x' }, { value: '3', label: '3x' }]} value={scale} onChange={setScale} />
          </Chip>
          <span className="ml-auto tnum text-fg-faint">{dims.w} × {dims.h} · {scale}x</span>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <span className="mr-auto text-xs text-fg-faint" role="status" aria-live="polite">{status}</span>
          <button type="button" onClick={onCopy} disabled={busy !== null} className="flex items-center gap-1.5 rounded border border-line bg-bg-1 px-3 py-1.5 text-xs text-fg-dim transition hover:border-line-2 hover:text-fg active:scale-[0.97] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
            {done === 'copy' ? <Check className="size-3.5 text-positive" /> : done === 'fail' ? <X className="size-3.5 text-warning" /> : <Copy className="size-3.5" />} {busy === 'copy' ? 'copying…' : done === 'copy' ? 'copied' : done === 'fail' ? 'copy failed' : 'copy'}
          </button>
          <button type="button" ref={dlRef} onClick={onDownload} disabled={busy !== null} className="flex items-center gap-1.5 rounded border border-accent/60 bg-bg-1 px-3 py-1.5 text-xs text-accent transition hover:bg-bg-2 active:scale-[0.97] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
            {done === 'dl' ? <Check className="size-3.5 text-positive" /> : <Download className="size-3.5" />} {busy === 'download' ? 'downloading…' : 'download PNG'}
          </button>
        </div>
      </div>
    </div>
  )
}

const SEG = 'flex items-center overflow-hidden rounded border border-line text-[10px]'

function Chip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-fg-faint">{label}</span>
      {children}
    </span>
  )
}
