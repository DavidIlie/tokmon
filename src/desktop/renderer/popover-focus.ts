interface Blurrable {
  blur(): void
}

/** Release retained Chromium focus before a hidden popover is reopened. */
export function releasePopoverFocus(activeElement: unknown): boolean {
  if (!activeElement || typeof (activeElement as Partial<Blurrable>).blur !== 'function') return false
  ;(activeElement as Blurrable).blur()
  return true
}
