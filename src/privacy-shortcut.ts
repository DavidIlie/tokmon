export interface PrivacyShortcutEvent {
  readonly key: string
  readonly metaKey?: boolean
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly shiftKey?: boolean
  readonly repeat?: boolean
  readonly editable?: boolean
  readonly target?: unknown
}

function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as { isContentEditable?: boolean; tagName?: unknown }
  if (element.isContentEditable) return true
  return typeof element.tagName === 'string'
    && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName.toUpperCase())
}

/** Shared dashboard shortcut semantics for TUI-adjacent browser renderers. */
export function matchesPrivacyShortcut(event: PrivacyShortcutEvent, configuredKey: string): boolean {
  return configuredKey.length === 1
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
    && !event.repeat
    && !event.editable
    && !isEditableTarget(event.target)
    && event.key.toLowerCase() === configuredKey.toLowerCase()
}
