export interface RefreshShortcutEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  target: EventTarget | null
}

export function isRefreshShortcut(event: RefreshShortcutEvent): boolean {
  if (event.key.toLowerCase() !== 'r' || event.metaKey || event.ctrlKey || event.altKey) return false
  const target = event.target as (EventTarget & { isContentEditable?: boolean; tagName?: string }) | null
  if (!target) return true
  if (target.isContentEditable) return false
  return !target.tagName || !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
