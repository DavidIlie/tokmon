import type { InputKey, KeyContext } from './keybinding-context'
import { handleAccountEditor, handleSearchEditor, handleTimezoneEditor } from './keybindings-editors'
import { handleSettings } from './keybindings-settings'
import { handleGlobalCommand, handleNavigation } from './keybindings-navigation'

export type { InputKey, KeyContext } from './keybinding-context'

export type TerminalFocusEvent = 'in' | 'out'

/** Ink strips the leading ESC byte from DEC focus-reporting sequences. */
export function terminalFocusEvent(input: string): TerminalFocusEvent | null {
  if (input === '[I') return 'in'
  if (input === '[O') return 'out'
  return null
}

export function handleTerminalFocusInput(input: string, onFocusIn: () => void): boolean {
  const event = terminalFocusEvent(input)
  if (!event) return false
  if (event === 'in') onFocusIn()
  return true
}

export function isRefreshAllShortcut(input: string, mode: {
  showPicker: boolean
  editingAccount: boolean
  editingTimezone: boolean
  editingSearch: boolean
  unavailable?: boolean
}): boolean {
  return (input === 'r' || input === 'R')
    && !mode.unavailable
    && !mode.showPicker
    && !mode.editingAccount
    && !mode.editingTimezone
    && !mode.editingSearch
}

function handleOnboarding(input: string, key: InputKey, ctx: KeyContext): void {
  const { onboarding, global } = ctx
  if (input === 'q') { global.exit(); return }
  const confirmIndex = onboarding.providers.length
  if (key.upArrow) { onboarding.setCursor(cursor => Math.max(0, cursor - 1)); return }
  if (key.downArrow) { onboarding.setCursor(cursor => Math.min(confirmIndex, cursor + 1)); return }
  if (input === ' ') { onboarding.toggle(onboarding.cursor); return }
  if (key.return) {
    if (onboarding.cursor === confirmIndex) onboarding.confirm()
    else onboarding.toggle(onboarding.cursor)
  }
}

/** Ordered modal router: text entry wins, then global commands, then active view. */
export function handleKey(input: string, key: InputKey, ctx: KeyContext): void {
  const editingAccount = ctx.settings.show && ctx.accountEditor.form !== null
  const editingTimezone = ctx.settings.show && ctx.timezoneEditor.value !== null
  const editingSearch = ctx.table.tab === 1 && ctx.table.searchMode

  if (isRefreshAllShortcut(input, {
    showPicker: ctx.onboarding.show,
    editingAccount,
    editingTimezone,
    editingSearch,
    unavailable: !ctx.global.configReady,
  })) {
    ctx.global.refreshAll()
    return
  }
  if (ctx.onboarding.show) { handleOnboarding(input, key, ctx); return }
  if (editingAccount) { handleAccountEditor(input, key, ctx.accountEditor, ctx.textInput); return }
  if (editingTimezone) {
    handleTimezoneEditor(input, key, ctx.timezoneEditor, ctx.textInput, ctx.global.updateConfig)
    return
  }
  if (editingSearch) { handleSearchEditor(input, key, ctx.table, ctx.textInput); return }
  if (handleGlobalCommand(input, ctx)) return
  if (ctx.settings.show) { handleSettings(input, key, ctx); return }
  handleNavigation(input, key, ctx)
}
