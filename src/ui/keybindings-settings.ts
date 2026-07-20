import { PROVIDER_ORDER } from '../providers'
import { toggleProviderSelection } from '../config'
import { DESKTOP_FIXED_ROWS, DESKTOP_FIXED_SETTINGS, GENERAL_ROWS, GENERAL_SETTINGS, SETTINGS_TABS, THEME_ROWS, THEME_SETTINGS } from './settings'
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
    : tab === 'theme'
      ? THEME_ROWS
      : tab === 'desktop'
        ? DESKTOP_FIXED_ROWS + PROVIDER_ORDER.length
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
    GENERAL_SETTINGS[cursor]?.onAdjust(input, key, ctx)
    return
  }
  if (tab === 'theme') {
    THEME_SETTINGS[cursor]?.onAdjust(input, key, ctx)
    return
  }
  if (tab === 'desktop') {
    if (cursor < DESKTOP_FIXED_ROWS) {
      DESKTOP_FIXED_SETTINGS[cursor]?.onAdjust(input, key, ctx)
      return
    }
    // Menu-bar pins: the provider rows below the fixed settings.
    const provider = PROVIDER_ORDER[cursor - DESKTOP_FIXED_ROWS]
    if (provider && (input === ' ' || key.leftArrow || key.rightArrow || key.return)) {
      updateConfig(current => ({
        ...current,
        tray: {
          ...current.tray,
          pinnedProviders: toggleProviderSelection(current.tray.pinnedProviders, provider, new Set(PROVIDER_ORDER), 2),
        },
      }))
    }
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
}
