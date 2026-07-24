import { PROVIDER_ORDER } from '../providers'
import { providerDetectionEnabled, setDetectedAccountExcluded, setProviderDetectionEnabled } from '../config'
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
        ? DESKTOP_FIXED_ROWS
      : tab === 'providers'
          ? PROVIDER_ORDER.length + 1
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
    DESKTOP_FIXED_SETTINGS[cursor]?.onAdjust(input, key, ctx)
    return
  }
  if (tab === 'providers') {
    if (cursor === 0 && (input === ' ' || key.return || key.leftArrow || key.rightArrow)) {
      updateConfig(current => ({
        ...current,
        accountDetection: { ...current.accountDetection, enabled: !current.accountDetection.enabled },
      }))
      return
    }
    const provider = PROVIDER_ORDER[cursor - 1]
    if (provider && input === 'a') {
      updateConfig(current => ({
        ...current,
        accountDetection: setProviderDetectionEnabled(
          current.accountDetection,
          provider,
          !providerDetectionEnabled(current.accountDetection, provider),
        ),
      }))
      return
    }
    if (provider && (input === ' ' || key.return || key.leftArrow || key.rightArrow)) {
      toggleProvider(provider)
    }
    return
  }
  if (cursor < trackedAccounts.length) {
    const row = trackedAccounts[cursor]
    if (row.source === 'ignored' && (key.return || input === 'x')) {
      if (row.excludedRef) updateConfig(current => ({
        ...current,
        accountDetection: setDetectedAccountExcluded(current.accountDetection, row.excludedRef!, false),
      }))
      return
    }
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
    if (row.source === 'configured' && row.explicitId && input === 'e') {
      updateConfig(current => ({
        ...current,
        activeAccountId:
          !row.enabled || current.activeAccountId !== row.id
            ? current.activeAccountId
            : null,
        accounts: current.accounts.map(account =>
          account.id === row.explicitId ? { ...account, enabled: !row.enabled } : account),
      }))
      return
    }
    if (row.source === 'auto' && input === 'x') {
      updateConfig(current => ({
        ...current,
        activeAccountId: current.activeAccountId === row.id ? null : current.activeAccountId,
        accountDetection: setDetectedAccountExcluded(current.accountDetection, {
          providerId: row.providerId,
          homeDir: row.homeDir,
        }, true),
      }))
      return
    }
    if (input === ' ' && row.enabled) { updateConfig(current => ({ ...current, activeAccountId: row.id })); return }
    return
  }
  if (cursor === trackedAccounts.length && key.return) openAddAccount()
}
