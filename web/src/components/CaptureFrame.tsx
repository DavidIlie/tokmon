import { forwardRef, useEffect, useRef } from 'react'
import { Watermark } from './Watermark'

// Wraps a snapshot of a live panel: clones its already-rendered DOM (charts are
// static SVG, so no Recharts re-measure), strips the hover chrome ([data-chrome]),
// and stamps the watermark. The clone means the live panel is never disturbed.
export const CaptureFrame = forwardRef<HTMLDivElement, {
  node: HTMLElement
  title: string
  framed: boolean
  wmPos: 'footer' | 'corner'
}>(function CaptureFrame({ node, title, framed, wmPos }, ref) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = host.current
    if (!h) return
    h.innerHTML = ''
    const clone = node.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[data-chrome]').forEach(e => e.remove())
    clone.style.width = `${Math.round(node.getBoundingClientRect().width)}px`
    clone.classList.remove('hover:border-line-2')
    h.appendChild(clone)
    return () => { h.innerHTML = '' }
  }, [node])

  return (
    <div
      ref={ref}
      className="relative"
      style={{
        background: 'var(--color-bg-0)',
        backgroundImage: 'radial-gradient(var(--color-line-faint) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        padding: framed ? 28 : 16,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {framed && (
        <div className="mb-3 flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-warning" />
          <span className="size-2.5 rounded-full bg-cost" />
          <span className="size-2.5 rounded-full bg-positive" />
          <span className="ml-2 font-display text-xs uppercase tracking-wider text-fg-dim">{title}</span>
        </div>
      )}
      <div ref={host} />
      {wmPos === 'footer'
        ? <div className="mt-3 flex justify-end"><Watermark variant="footer" /></div>
        : <Watermark variant="corner" />}
    </div>
  )
})
