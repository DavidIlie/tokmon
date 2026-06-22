import { useRef, type ReactNode } from 'react'
import { Camera } from '../icons'
import { useShare } from '../share-provider'

export function Panel({
  title, titleTag, right, captureName, children, className = '', bodyClassName = '',
}: {
  title?: string
  titleTag?: ReactNode
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
    >
      {title && (
        <div className="pointer-events-none absolute -top-[7px] left-3 flex items-center gap-2 bg-bg-1 px-1.5">
          <span className="font-display text-[11px] uppercase tracking-wider text-fg-dim">{title}</span>
          {titleTag != null && <span className="text-[10px] normal-case tracking-normal text-fg-faint">{titleTag}</span>}
        </div>
      )}
      {right && (
        <div data-chrome className="absolute right-2 top-2 z-20 flex items-center gap-1.5 rounded bg-bg-1 px-0.5">
          {right}
        </div>
      )}
      {captureName && (
        <div data-chrome className="absolute -top-[11px] right-3 z-20">
          <CaptureButton getNode={() => ref.current} name={captureName} />
        </div>
      )}
      <div className={`p-4 ${bodyClassName}`}>{children}</div>
    </section>
  )
}

export function CaptureButton({ getNode, name }: { getNode: () => HTMLElement | null; name: string }) {
  const openShare = useShare()
  return (
    <button
      type="button"
      title="Share this panel"
      aria-label="Share this panel as an image"
      onClick={() => { const node = getNode(); if (node) openShare({ kind: 'panel', node, captureName: name }) }}
      className="rounded border border-transparent bg-bg-1 p-1 text-fg-faint opacity-0 transition hover:border-line hover:text-accent group-hover:opacity-100 focus-visible:opacity-100"
    >
      <Camera className="size-3.5" />
    </button>
  )
}
