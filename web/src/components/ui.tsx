import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Check, ChevronDown, Copy, Download } from './icons'
import { downloadNode, shareFilename } from '../lib/share'

export function Panel({
  title, accent, right, captureName, children, className = '', bodyClassName = '',
}: {
  title?: string
  accent?: string
  right?: ReactNode
  captureName?: string
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <section
      ref={ref}
      className={`group relative rounded-md border border-line bg-bg-1/80 transition-colors hover:border-line-2 ${className}`}
      style={accent ? { boxShadow: `inset 0 2px 0 0 ${accent}` } : undefined}
    >
      {title && (
        <div className="pointer-events-none absolute -top-[7px] left-3 flex items-center gap-2 bg-bg-1 px-1.5">
          <span className="font-display text-[11px] uppercase tracking-wider text-fg-dim">{title}</span>
        </div>
      )}
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
        {right}
        {captureName && <CaptureButton getNode={() => ref.current} name={captureName} />}
      </div>
      <div className={`p-4 ${bodyClassName}`}>{children}</div>
    </section>
  )
}

export function CaptureButton({ getNode, name }: { getNode: () => HTMLElement | null; name: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      title="Save panel as PNG"
      aria-label="Save panel as PNG"
      onClick={async () => {
        const node = getNode()
        if (!node) return
        await downloadNode(node, shareFilename(name))
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="rounded border border-transparent p-1 text-fg-faint opacity-0 transition hover:border-line hover:text-accent group-hover:opacity-100 focus-visible:opacity-100"
    >
      {done ? <Check className="size-3.5 text-positive" /> : <Camera className="size-3.5" />}
    </button>
  )
}

export function PromptHeader({ label, crumb }: { label: string; crumb?: string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-prompt">$</span>
      {crumb && <span className="text-fg-faint">{crumb}</span>}
      <span className="text-fg-bright">{label}</span>
      <span className="cursor-blink text-accent">▋</span>
    </div>
  )
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
export function Sparkline({ data, color = 'var(--color-accent)', className = '' }: { data: number[]; color?: string; className?: string }) {
  const max = Math.max(...data, 0)
  return (
    <span className={`font-mono leading-none ${className}`} style={{ color }} aria-hidden>
      {data.length === 0
        ? '·'
        : data.map(v => SPARK[max <= 0 ? 0 : Math.min(7, Math.floor((v / max) * 7.999))]).join('')}
    </span>
  )
}

export function Delta({ value, positiveIsGood = false }: { value: number; positiveIsGood?: boolean }) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.001) return <span className="text-fg-faint text-xs">—</span>
  const up = value > 0
  const good = positiveIsGood ? up : !up
  return (
    <span className={`text-xs tnum ${good ? 'text-positive' : 'text-warning'}`}>
      {up ? '▲' : '▼'} {Math.abs(value * 100).toFixed(0)}%
    </span>
  )
}

export function StatBlock({ label, value, sub, valueClass = 'text-fg-bright' }: {
  label: string; value: ReactNode; sub?: ReactNode; valueClass?: string
}) {
  return (
    <div>
      <div className="font-display text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`tnum mt-1 text-xl ${valueClass}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-xs text-fg-dim">{sub}</div>}
    </div>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center text-center text-xs text-fg-faint">
      {children}
    </div>
  )
}

export function ToolButton({ onClick, active, children, title }: {
  onClick: () => void; active?: boolean; children: ReactNode; title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition ${
        active ? 'border-accent/60 bg-bg-2 text-accent' : 'border-line bg-bg-1 text-fg-dim hover:border-line-2 hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  options, value, onChange, size = 'sm', btnClassName, containerClassName,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'xs'
  btnClassName?: string
  containerClassName?: string
}) {
  const defaultContainer = 'flex items-center overflow-hidden rounded border border-line'
  const defaultBtn = size === 'xs'
    ? 'px-1.5 py-0.5 transition'
    : 'px-2 py-1 text-xs transition'
  const activeClass = size === 'xs' ? 'bg-bg-3 text-accent' : 'bg-bg-2 text-accent'
  const inactiveClass = size === 'xs' ? 'text-fg-faint hover:text-fg' : 'text-fg-dim hover:text-fg'
  return (
    <div className={containerClassName ?? defaultContainer}>
      {options.map(o => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`${btnClassName ?? defaultBtn} ${value === o.value ? activeClass : inactiveClass}`}
        >{o.label}</button>
      ))}
    </div>
  )
}

export function Dropdown({ label, value, children }: { label: string; value: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2 py-1 text-xs text-fg-dim transition hover:border-line-2 hover:text-fg"
      >
        <span className="text-fg-faint">{label}:</span>
        <span className="text-fg">{value}</span>
        <ChevronDown className={`size-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 min-w-44 rounded-md border border-line-2 bg-bg-2 p-1 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function Menu({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>
}

export function MenuItem({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded px-2 py-1 text-left text-xs transition ${
        active ? 'bg-bg-3 text-fg-bright' : 'text-fg-dim hover:bg-bg-3 hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

export { Download, Copy, Check }
