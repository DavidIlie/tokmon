import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from '../icons'

export function ToolButton({ onClick, active, children, title }: {
  onClick: () => void
  active?: boolean
  children: ReactNode
  title?: string
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
  const defaultBtn = size === 'xs' ? 'px-1.5 py-0.5 transition' : 'px-2 py-1 text-xs transition'
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

export function Dropdown({ label, value, children }: {
  label: string
  value: string
  children: (close: () => void) => ReactNode
}) {
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

export function MenuItem({ active, onClick, children }: {
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
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
