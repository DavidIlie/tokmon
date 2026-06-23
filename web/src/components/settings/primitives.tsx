import { useState, type ReactNode } from 'react'
import { FOCUS } from './use-dialog-trap'

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-2.5 flex items-center gap-2 border-b border-line pb-1.5">
        <h3 className="font-display text-[11px] uppercase tracking-wider text-fg-dim">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  )
}

export function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg">{label}</div>
        {hint && <div className="text-[11px] text-fg-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-fg">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-fg-faint">{hint}</div>}
    </div>
  )
}

export function NumberStepper({ value, min, unit, onChange }: { value: number; min: number; unit: string; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(min, Math.round(v)))
  const [buf, setBuf] = useState<string | null>(null)
  const commit = () => {
    if (buf === null) return
    const n = Number(buf)
    set(Number.isFinite(n) && buf.trim() !== '' ? n : min)
    setBuf(null)
  }
  return (
    <div className="flex items-center overflow-hidden rounded border border-line">
      <button type="button" aria-label="decrease" onClick={() => set(value - 1)} className={`px-2 py-1 text-xs text-fg-dim transition hover:bg-bg-3 hover:text-fg ${FOCUS}`}>−</button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={buf ?? value}
        onChange={e => {
          const v = e.target.value
          setBuf(v)
          const n = Number(v)
          if (v.trim() !== '' && Number.isFinite(n) && n >= min) set(n)
        }}
        onBlur={commit}
        aria-label={`value (${unit})`}
        className={`tnum w-12 border-x border-line bg-bg-2 px-1 py-1 text-center text-xs text-fg ${FOCUS} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <span className="px-1.5 text-[10px] text-fg-faint">{unit}</span>
      <button type="button" aria-label="increase" onClick={() => set(value + 1)} className={`px-2 py-1 text-xs text-fg-dim transition hover:bg-bg-3 hover:text-fg ${FOCUS}`}>+</button>
    </div>
  )
}

export function IconBtn({ label, onClick, disabled, danger, children }: {
  label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1 text-fg-faint transition disabled:opacity-30 ${FOCUS} ${
        danger ? 'hover:bg-warning/15 hover:text-warning' : 'hover:bg-bg-3 hover:text-fg'
      } disabled:hover:bg-transparent disabled:hover:text-fg-faint`}
    >
      {children}
    </button>
  )
}
