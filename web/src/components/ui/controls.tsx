import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from '../icons'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent'

export function Segmented<T extends string>({
  options, value, onChange, size = 'sm', btnClassName, containerClassName, ariaLabel,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'xs'
  btnClassName?: string
  containerClassName?: string
  ariaLabel?: string
}) {
  const defaultContainer = 'flex items-center overflow-hidden rounded border border-line'
  const defaultBtn = size === 'xs' ? 'px-1.5 py-0.5 text-[10px] transition max-sm:py-1.5' : 'px-2 py-1 text-xs transition max-sm:py-2'
  const activeClass = size === 'xs' ? 'bg-bg-3 text-accent' : 'bg-bg-2 text-accent'
  const inactiveClass = size === 'xs' ? 'text-fg-faint hover:text-fg' : 'text-fg-dim hover:text-fg'
  return (
    <div className={containerClassName ?? defaultContainer} role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`${btnClassName ?? defaultBtn} ${FOCUS} ${value === o.value ? activeClass : inactiveClass}`}
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next: number | null = null
    if (event.key === 'Escape') { event.preventDefault(); close(true); return }
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = items.length - 1
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
    if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
    if (next !== null && items[next]) { event.preventDefault(); items[next].focus() }
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={event => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
          requestAnimationFrame(() => {
            const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
            items?.[event.key === 'ArrowDown' ? 0 : items.length - 1]?.focus()
          })
        }}
        className={`flex items-center gap-1.5 rounded border border-line bg-bg-1 px-2 py-1 text-xs text-fg-dim transition hover:border-line-2 hover:text-fg max-sm:py-2 ${FOCUS}`}
      >
        <span className="text-fg-faint">{label}:</span>
        <span className="text-fg">{value}</span>
        <ChevronDown className={`size-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={menuId} ref={menuRef} role="menu" onKeyDown={onMenuKeyDown} className="absolute right-0 z-50 mt-1 min-w-44 max-w-[calc(100vw-2.5rem)] rounded-md border border-line-2 bg-bg-2 p-1 shadow-xl">
          {children(() => close(true))}
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
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-xs transition ${FOCUS} ${
        active ? 'bg-bg-3 text-fg-bright' : 'text-fg-dim hover:bg-bg-3 hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
