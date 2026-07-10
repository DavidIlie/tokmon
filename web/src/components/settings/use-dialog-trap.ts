import { useEffect, useRef } from 'react'

export const FOCUS = 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent'
export const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'

export function useDialogTrap(
  panelRef: React.RefObject<HTMLElement>,
  { active, onEscape, initialFocusRef }: {
    active: boolean
    onEscape: () => void
    initialFocusRef?: React.RefObject<HTMLElement>
  },
) {
  const escapeRef = useRef(onEscape)
  useEffect(() => { escapeRef.current = onEscape }, [onEscape])

  useEffect(() => {
    if (!active) return
    const prev = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(initialFocusRef?.current ?? firstFocusable ?? panel)?.focus?.()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); escapeRef.current(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const f = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      const vis = Array.from(f).filter(el => el.offsetParent !== null || el === document.activeElement)
      if (vis.length === 0) return
      const first = vis[0], last = vis[vis.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [active, initialFocusRef, panelRef])
}
