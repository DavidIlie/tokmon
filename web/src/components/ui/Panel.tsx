import { useRef, useState, type ReactNode } from 'react'
import { Camera, Check } from '../icons'
import { downloadNode, shareFilename } from '../../lib/share'

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
        // Box-drawing notched title: absolutely positioned above the top border.
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
