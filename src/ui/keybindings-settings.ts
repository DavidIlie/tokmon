import { PROVIDER_ORDER } from '../providers'
import { sanitizeTyped } from '../config'
import { systemTimezone } from '../tz'
import { GENERAL_ROWS, SETTINGS_TABS } from './settings'
import type { InputKey, KeyContext } from './keybinding-context'

export function handleSettings(input: string, key: InputKey, ctx: KeyContext): void {
  const {
    settings,
    timezoneEditor,
    textInput,
    global: { config, updateConfig },
  } = ctx
  const {
    cursor, tab, setShow, setTab, setCursor, trackedAccounts, moveAccount,
    toggleProvider, openEditAccount, openConfigureAccount, deleteAccount, openAddAccount,
  } = settings

  if (key.escape || input === 's') { setShow(false); return }

  const switchTab = (direction: 1 | -1) => {
    const index = SETTINGS_TABS.indexOf(tab)
    setTab(SETTINGS_TABS[(index + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length])
    setCursor(-1)
    timezoneEditor.setValue(null)
    timezoneEditor.setError(null)
    ctx.allowedHostsEditor.setValue(null)
    ctx.allowedHostsEditor.setError(null)
  }
  const rowCount = tab === 'general'
    ? GENERAL_ROWS
    : tab === 'providers'
      ? PROVIDER_ORDER.length
      : trackedAccounts.length + 1

  if (key.tab) { switchTab(key.shift ? -1 : 1); return }
  if (input === '[') { switchTab(-1); return }
  if (input === ']') { switchTab(1); return }

  if (cursor < 0) {
    if (key.leftArrow) { switchTab(-1); return }
    if (key.rightArrow) { switchTab(1); return }
    if (key.downArrow || key.return) { setCursor(0); return }
    if (key.upArrow) { setCursor(Math.max(0, rowCount - 1)); return }
    return
  }

  const selected = tab === 'accounts' && cursor < trackedAccounts.length ? trackedAccounts[cursor] : null
  if (selected?.source === 'configured' && selected.explicitIndex !== undefined && key.shift && (key.upArrow || key.downArrow)) {
    moveAccount(selected.explicitIndex, key.upArrow ? -1 : 1)
    return
  }
  if (key.upArrow) { setCursor(current => Math.max(-1, current - 1)); return }
  if (key.downArrow) { setCursor(current => Math.min(rowCount - 1, current + 1)); return }

  if (tab === 'general') {
    handleGeneralSetting(input, key, ctx)
    return
  }
  if (tab === 'providers') {
    if (cursor < PROVIDER_ORDER.length && (input === ' ' || key.return || key.leftArrow || key.rightArrow)) {
      toggleProvider(PROVIDER_ORDER[cursor])
    }
    return
  }
  if (cursor < trackedAccounts.length) {
    const row = trackedAccounts[cursor]
    if (key.return) {
      if (row.source === 'configured') {
        const account = config.accounts.find(candidate => candidate.id === row.explicitId)
        if (account) openEditAccount(account)
      } else {
        openConfigureAccount(row)
      }
      return
    }
    if (row.source === 'configured' && row.explicitId && (input === 'd' || input === 'x')) {
      deleteAccount(row.explicitId)
      return
    }
    if (input === ' ') { updateConfig(current => ({ ...current, activeAccountId: row.id })); return }
    return
  }
  if (cursor === trackedAccounts.length && key.return) openAddAccount()

  function handleGeneralSetting(value: string, inputKey: InputKey, context: KeyContext): void {
    const index = context.settings.cursor
    if (index === 0) {
      if (inputKey.leftArrow) updateConfig(current => ({ ...current, interval: Math.max(1, current.interval - 1) }))
      if (inputKey.rightArrow) updateConfig(current => ({ ...current, interval: current.interval + 1 }))
      return
    }
    if (index === 1) {
      if (inputKey.leftArrow) updateConfig(current => ({ ...current, billingInterval: Math.max(1, current.billingInterval - 1) }))
      if (inputKey.rightArrow) updateConfig(current => ({ ...current, billingInterval: current.billingInterval + 1 }))
      return
    }
    if (index === 2 && (inputKey.leftArrow || inputKey.rightArrow || inputKey.return)) {
      updateConfig(current => ({ ...current, clearScreen: !current.clearScreen })); return
    }
    if (index === 3 && (inputKey.leftArrow || inputKey.rightArrow || inputKey.return)) {
      updateConfig(current => ({ ...current, privacyMode: !current.privacyMode })); return
    }
    if (index === 4) {
      if (textInput.isPrintable(value, inputKey)) {
        const clean = sanitizeTyped(value)
        if (clean.length === 1) updateConfig(current => ({ ...current, privacyToggleKey: clean }))
      }
      if (inputKey.backspace || inputKey.delete) updateConfig(current => ({ ...current, privacyToggleKey: 'p' }))
      return
    }
    if (index === 5) {
      if (inputKey.return) {
        const initial = config.timezone ?? ''
        timezoneEditor.setValue(initial)
        timezoneEditor.setCaret(initial.length)
        timezoneEditor.setError(null)
      }
      if (inputKey.leftArrow || inputKey.rightArrow) {
        updateConfig(current => ({ ...current, timezone: current.timezone === null ? systemTimezone() : null }))
      }
      return
    }
    if (index === 6 && (inputKey.leftArrow || inputKey.rightArrow || inputKey.return)) {
      updateConfig(current => ({ ...current, dashboardLayout: current.dashboardLayout === 'grid' ? 'single' : 'grid' }))
      return
    }
    if (index === 7 && (inputKey.leftArrow || inputKey.rightArrow || inputKey.return)) {
      updateConfig(current => ({ ...current, defaultFocus: current.defaultFocus === 'all' ? 'last' : 'all' }))
      return
    }
    if (index === 8 && (inputKey.leftArrow || inputKey.rightArrow || inputKey.return)) {
      updateConfig(current => ({ ...current, allowNetworkAccess: !current.allowNetworkAccess }))
      return
    }
    if (index === 9 && inputKey.return) {
      const initial = config.allowedHosts.join(', ')
      context.allowedHostsEditor.setValue(initial)
      context.allowedHostsEditor.setCaret(initial.length)
      context.allowedHostsEditor.setError(null)
      return
    }
    if (index === 10 && (inputKey.leftArrow || inputKey.rightArrow || inputKey.return)) {
      updateConfig(current => ({ ...current, resetDisplay: current.resetDisplay === 'relative' ? 'absolute' : 'relative' }))
    }
  }
}
