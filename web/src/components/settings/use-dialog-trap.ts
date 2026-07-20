import { useEffect, useRef } from 'react'

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
    const panel = panelRef.current
    const opener = document.activeElement as HTMLElement | null
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(initialFocusRef?.current ?? firstFocusable ?? panel)?.focus?.()

    // Track the most recent focus target *inside* this panel. When the dialog
    // unmounts we restore focus to the opener; if the opener is gone we fall
    // back to this last-inside node rather than the first focusable control
    // (which is often a destructive ✕ close button).
    let lastInside: HTMLElement | null = document.activeElement as HTMLElement | null
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null
      if (target && panelRef.current?.contains(target)) lastInside = target
    }
    document.addEventListener('focusin', onFocusIn)

    const onKey = (e: KeyboardEvent) => {
      const p = panelRef.current
      // While a nested dialog is open the background panel is marked `inert`;
      // its trap must ignore keys so only the top-most dialog handles Esc/Tab.
      if (!p || p.hasAttribute('inert')) return
      if (e.key === 'Escape') { e.stopPropagation(); escapeRef.current(); return }
      if (e.key !== 'Tab') return
      const f = p.querySelectorAll<HTMLElement>(FOCUSABLE)
      const vis = Array.from(f).filter(el => el.offsetParent !== null || el === document.activeElement)
      if (vis.length === 0) return
      const first = vis[0], last = vis[vis.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocusIn)
      const restore = opener && opener.isConnected ? opener : lastInside
      restore?.focus?.()
    }
  }, [active, initialFocusRef, panelRef])
}
