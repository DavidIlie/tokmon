import { useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { X } from '../icons'
import { useDialogTrap } from '../settings/use-dialog-trap'
import { FOCUS_RING } from './primitives'

/**
 * Shared modal overlay: `fixed inset-0` backdrop with blur, backdrop-close,
 * `role="dialog" aria-modal`, the `dialog-pop` panel, an optional ✕ close
 * button, and the focus trap. One z-index / backdrop opacity / alignment is
 * used everywhere so the three former hand-rolled copies stay in sync.
 */
export function Dialog({
  onClose,
  labelledBy,
  initialFocusRef,
  panelRef: externalPanelRef,
  className = '',
  panelStyle,
  active = true,
  closeOnBackdrop = true,
  showClose = true,
  children,
}: {
  onClose: () => void
  labelledBy: string
  initialFocusRef?: RefObject<HTMLElement>
  panelRef?: RefObject<HTMLDivElement>
  className?: string
  panelStyle?: CSSProperties
  active?: boolean
  closeOnBackdrop?: boolean
  showClose?: boolean
  children: ReactNode
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const panelRef = externalPanelRef ?? innerRef
  useDialogTrap(panelRef, { active, onEscape: onClose, initialFocusRef })

  return (
    <div
      className="dialog-fade fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto overscroll-contain bg-bg-0/70 p-4 backdrop-blur-sm"
      onMouseDown={e => { if (closeOnBackdrop && e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        style={panelStyle}
        className={`dialog-pop relative overflow-hidden rounded-md border border-line-2 bg-bg-1 focus:outline-none ${className}`}
      >
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`absolute right-2 top-2 z-10 rounded p-1 text-fg-faint transition hover:text-fg ${FOCUS_RING}`}
          >
            <X className="size-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
