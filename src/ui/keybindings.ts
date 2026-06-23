import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { PROVIDERS, PROVIDER_ORDER, type ProviderId } from '../providers'
import { sanitizeTyped, type Config, type Account as StoredAccount, type TrackedAccountRow } from '../config'
import { isValidTimezone, systemTimezone } from '../tz'
import { TABS, VIEWS, type Slot, clampCaret, spliceBackspace } from '../app.logic'
import { ACCOUNT_ROWS_START, PROVIDER_ROWS_START, type AccountForm } from './settings'
import { openUrl, REPO_URL } from './terminal'

export interface InputKey {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  pageUp: boolean
  pageDown: boolean
  return: boolean
  escape: boolean
  tab: boolean
  shift: boolean
  ctrl: boolean
  meta: boolean
  backspace: boolean
  delete: boolean
}

export interface KeyContext {
  showPicker: boolean
  pickerProviders: ProviderId[]
  onboardCursor: number
  setOnboardCursor: Dispatch<SetStateAction<number>>
  toggleOnboard: (i: number) => void
  confirmOnboarding: () => void
  exit: () => void

  showSettings: boolean
  accountForm: AccountForm | null
  setAccountForm: Dispatch<SetStateAction<AccountForm | null>>
  commitAccountForm: () => void
  cycleFormField: (dir: 1 | -1) => void
  cycleProvider: (dir: 1 | -1) => void
  cycleColor: (dir: 1 | -1) => void
  isPrintable: (input: string, key: { ctrl: boolean; meta: boolean }) => boolean
  insertText: (text: string) => void

  tzEdit: string | null
  setTzEdit: Dispatch<SetStateAction<string | null>>
  setTzError: Dispatch<SetStateAction<string | null>>
  updateConfig: (fn: (prev: Config) => Config) => void
  setTzCaret: Dispatch<SetStateAction<number>>
  tzValueRef: MutableRefObject<string>
  tzCaretRef: MutableRefObject<number>

  tab: number
  searchMode: boolean
  setSearchMode: Dispatch<SetStateAction<boolean>>
  search: string
  setSearch: Dispatch<SetStateAction<string>>
  setSearchCaret: Dispatch<SetStateAction<number>>
  searchValueRef: MutableRefObject<string>
  searchCaretRef: MutableRefObject<number>

  showLoader: boolean
  configReady: boolean
  toggleWeb: () => Promise<void>
  settingsCursor: number
  setShowSettings: Dispatch<SetStateAction<boolean>>
  cfg: Config
  trackedAccountRows: TrackedAccountRow[]
  totalSettingsRows: number
  moveAccount: (idx: number, dir: -1 | 1) => void
  setSettingsCursor: Dispatch<SetStateAction<number>>
  toggleProvider: (pid: ProviderId) => void
  openEditAccount: (acc: StoredAccount) => void
  openConfigureAccount: (row: TrackedAccountRow) => void
  deleteAccount: (id: string) => void
  openAddAccount: () => void

  cycleAccount: (dir: 1 | -1) => void
  setTab: Dispatch<SetStateAction<number>>
  resetView: () => void
  slots: Slot[]
  dashPaginated: boolean
  dashPageCount: number
  setDashPage: Dispatch<SetStateAction<number>>

  cycleTableProvider: (dir: 1 | -1) => void
  setExpanded: Dispatch<SetStateAction<number>>
  setSort: Dispatch<SetStateAction<number>>
  SORTS_FOR: readonly { label: string; dir: 'up' | 'down' | null }[]
  tableIsCursor: boolean
  setView: Dispatch<SetStateAction<number>>
  cursor: number
  rowCountRef: MutableRefObject<number>
  rows: number
  setCursor: Dispatch<SetStateAction<number>>
  clampRow: (n: number) => number
}

export function handleKey(input: string, key: InputKey, ctx: KeyContext): void {
  const {
    showPicker, pickerProviders, onboardCursor, setOnboardCursor, toggleOnboard, confirmOnboarding, exit,
    showSettings, accountForm, setAccountForm, commitAccountForm, cycleFormField, cycleProvider, cycleColor,
    isPrintable, insertText, tzEdit, setTzEdit, setTzError, updateConfig, setTzCaret, tzValueRef, tzCaretRef,
    tab, searchMode, setSearchMode, search, setSearch, setSearchCaret, searchValueRef, searchCaretRef,
    showLoader, configReady, toggleWeb, settingsCursor, setShowSettings, cfg, trackedAccountRows, totalSettingsRows, moveAccount,
    setSettingsCursor, toggleProvider, openEditAccount, openConfigureAccount, deleteAccount, openAddAccount, cycleAccount, setTab,
    resetView, slots, dashPaginated, dashPageCount, setDashPage, cycleTableProvider, setExpanded, setSort,
    SORTS_FOR, tableIsCursor, setView, cursor, rowCountRef, rows, setCursor, clampRow,
  } = ctx

  if (showPicker) {
    if (input === 'q') { exit(); return }
    const startIdx = pickerProviders.length
    if (key.upArrow) { setOnboardCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setOnboardCursor(c => Math.min(startIdx, c + 1)); return }
    if (input === ' ') { toggleOnboard(onboardCursor); return }
    if (key.return) {
      if (onboardCursor === startIdx) confirmOnboarding()
      else toggleOnboard(onboardCursor)
      return
    }
    return
  }

  if (showSettings && accountForm) {
    if (key.escape) { setAccountForm(null); return }
    if (key.ctrl && input === 's') { commitAccountForm(); return }
    if (key.tab) { cycleFormField(key.shift ? -1 : 1); return }
    if (key.upArrow) { cycleFormField(-1); return }
    if (key.downArrow) { cycleFormField(1); return }
    if (accountForm.field === 'provider') {
      if (key.leftArrow) { cycleProvider(-1); return }
      if (key.rightArrow) { cycleProvider(1); return }
      if (key.return) { setAccountForm(f => f && { ...f, field: 'name', caret: f.name.length }); return }
      return
    }
    if (accountForm.field === 'color') {
      if (key.leftArrow) { cycleColor(-1); return }
      if (key.rightArrow) { cycleColor(1); return }
      if (key.return) { commitAccountForm(); return }
      return
    }
    const tf = accountForm.field as 'name' | 'homeDir'
    if (key.leftArrow) { setAccountForm(f => f && { ...f, caret: clampCaret(f.caret - 1, f[tf].length) }); return }
    if (key.rightArrow) { setAccountForm(f => f && { ...f, caret: clampCaret(f.caret + 1, f[tf].length) }); return }
    if (key.ctrl && input === 'a') { setAccountForm(f => f && { ...f, caret: 0 }); return }
    if (key.ctrl && input === 'e') { setAccountForm(f => f && { ...f, caret: f[tf].length }); return }
    if (key.return) {
      if (tf === 'name' && accountForm.name.trim() === '') {
        setAccountForm(f => f && { ...f, error: 'Name required', caret: f.name.length })
        return
      }
      setAccountForm(f => f && { ...f, field: tf === 'name' ? 'homeDir' : 'color', caret: tf === 'name' ? f.homeDir.length : f.caret })
      return
    }
    if (key.backspace || key.delete) {
      setAccountForm(f => {
        if (!f || (f.field !== 'name' && f.field !== 'homeDir')) return f
        const r = spliceBackspace(f[f.field], f.caret)
        return { ...f, [f.field]: r.value, caret: r.caret, error: null }
      })
      return
    }
    if (isPrintable(input, key)) {
      const clean = sanitizeTyped(input)
      if (clean) insertText(clean)
    }
    return
  }

  if (showSettings && tzEdit !== null) {
    if (key.escape) { setTzEdit(null); setTzError(null); return }
    if (key.return) {
      const val = tzEdit.trim()
      if (val === '' || val.toLowerCase() === 'system') {
        updateConfig(c => ({ ...c, timezone: null })); setTzEdit(null); setTzError(null)
      } else if (isValidTimezone(val)) {
        updateConfig(c => ({ ...c, timezone: val })); setTzEdit(null); setTzError(null)
      } else {
        setTzError(`Invalid: ${val}`)
      }
      return
    }
    if (key.leftArrow) { setTzCaret(c => clampCaret(c - 1, tzEdit.length)); return }
    if (key.rightArrow) { setTzCaret(c => clampCaret(c + 1, tzEdit.length)); return }
    if (key.ctrl && input === 'a') { setTzCaret(0); return }
    if (key.ctrl && input === 'e') { setTzCaret(tzEdit.length); return }
    if (key.backspace || key.delete) {
      const r = spliceBackspace(tzValueRef.current, tzCaretRef.current)
      tzValueRef.current = r.value; tzCaretRef.current = r.caret
      setTzEdit(r.value); setTzCaret(r.caret); setTzError(null)
      return
    }
    if (isPrintable(input, key)) { const clean = sanitizeTyped(input); if (clean) insertText(clean) }
    return
  }

  if (tab === 1 && searchMode) {
    if (key.return || key.escape) { setSearchMode(false); if (key.escape) { setSearch(''); setSearchCaret(0) } return }
    if (key.leftArrow) { setSearchCaret(c => clampCaret(c - 1, search.length)); return }
    if (key.rightArrow) { setSearchCaret(c => clampCaret(c + 1, search.length)); return }
    if (key.ctrl && input === 'a') { setSearchCaret(0); return }
    if (key.ctrl && input === 'e') { setSearchCaret(search.length); return }
    if (key.backspace || key.delete) {
      const r = spliceBackspace(searchValueRef.current, searchCaretRef.current)
      searchValueRef.current = r.value; searchCaretRef.current = r.caret
      setSearch(r.value); setSearchCaret(r.caret)
      return
    }
    if (isPrintable(input, key)) { const clean = sanitizeTyped(input); if (clean) insertText(clean) }
    return
  }

  if (input === 'q') { exit(); return }
  if (input === 'O') { openUrl(REPO_URL); return }
  if (input === 'W' || (input === 'w' && tab !== 1 && !showSettings)) {
    if (showLoader || !configReady) return
    void toggleWeb(); return
  }

  if (showSettings) {
    if (key.escape || input === 's') { setShowSettings(false); return }
    const accIdxNav = settingsCursor - ACCOUNT_ROWS_START
    const onAccountRow = accIdxNav >= 0 && accIdxNav < trackedAccountRows.length
    const selectedAccountRow = onAccountRow ? trackedAccountRows[accIdxNav] : null
    if (selectedAccountRow?.source === 'configured' && selectedAccountRow.explicitIndex !== undefined && key.shift && (key.upArrow || key.downArrow)) {
      moveAccount(selectedAccountRow.explicitIndex, key.upArrow ? -1 : 1); return
    }
    if (key.upArrow) { setSettingsCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setSettingsCursor(c => Math.min(totalSettingsRows - 1, c + 1)); return }

    if (settingsCursor === 0) {
      if (key.leftArrow) updateConfig(c => ({ ...c, interval: Math.max(1, c.interval - 1) }))
      if (key.rightArrow) updateConfig(c => ({ ...c, interval: c.interval + 1 }))
      return
    }
    if (settingsCursor === 1) {
      if (key.leftArrow) updateConfig(c => ({ ...c, billingInterval: Math.max(1, c.billingInterval - 1) }))
      if (key.rightArrow) updateConfig(c => ({ ...c, billingInterval: c.billingInterval + 1 }))
      return
    }
    if (settingsCursor === 2 && (key.leftArrow || key.rightArrow || key.return)) {
      updateConfig(c => ({ ...c, clearScreen: !c.clearScreen })); return
    }
    if (settingsCursor === 3) {
      if (key.return) { const init = cfg.timezone ?? ''; setTzEdit(init); setTzCaret(init.length); setTzError(null) }
      if (key.leftArrow || key.rightArrow) updateConfig(c => ({ ...c, timezone: c.timezone === null ? systemTimezone() : null }))
      return
    }
    if (settingsCursor === 4 && (key.leftArrow || key.rightArrow || key.return)) {
      updateConfig(c => ({ ...c, dashboardLayout: c.dashboardLayout === 'grid' ? 'single' : 'grid' }))
      return
    }
    if (settingsCursor === 5 && (key.leftArrow || key.rightArrow || key.return)) {
      updateConfig(c => ({ ...c, defaultFocus: c.defaultFocus === 'all' ? 'last' : 'all' }))
      return
    }

    const provIdx = settingsCursor - PROVIDER_ROWS_START
    if (provIdx >= 0 && provIdx < PROVIDER_ORDER.length) {
      if (input === ' ' || key.return || key.leftArrow || key.rightArrow) toggleProvider(PROVIDER_ORDER[provIdx])
      return
    }

    const accIdx = settingsCursor - ACCOUNT_ROWS_START
    if (accIdx >= 0 && accIdx < trackedAccountRows.length) {
      const row = trackedAccountRows[accIdx]
      if (key.return) {
        if (row.source === 'configured') {
          const acc = cfg.accounts.find(a => a.id === row.explicitId)
          if (acc) openEditAccount(acc)
        } else {
          openConfigureAccount(row)
        }
        return
      }
      if (row.source === 'configured' && row.explicitId && (input === 'd' || input === 'x')) { deleteAccount(row.explicitId); return }
      if (input === ' ') { updateConfig(c => ({ ...c, activeAccountId: row.id })); return }
      return
    }
    if (accIdx === trackedAccountRows.length && key.return) { openAddAccount() }
    return
  }

  if (input === 's') { setShowSettings(true); setSettingsCursor(0); return }
  if (input === 'a') { cycleAccount(1); return }
  if (input === 'A') { cycleAccount(-1); return }
  if (key.tab) { setTab(t => (t + 1) % TABS.length); resetView(); return }
  if (input && /^[0-9]$/.test(input) && slots.length > 1) {
    const target = slots[parseInt(input, 10)]
    if (target) { updateConfig(c => ({ ...c, activeAccountId: target.id })); resetView() }
    return
  }
  if (tab === 0) {
    if (dashPaginated) {
      if (input === ']' || key.downArrow || key.pageDown) { setDashPage(p => Math.min(dashPageCount - 1, p + 1)); return }
      if (input === '[' || key.upArrow || key.pageUp) { setDashPage(p => Math.max(0, p - 1)); return }
    }
    if (key.upArrow || key.downArrow || key.pageUp || key.pageDown || input === 'G' || input === 'g') return
  }

  if (tab === 1) {
    if (input === 'p') { cycleTableProvider(1); return }
    if (input === 'P') { cycleTableProvider(-1); return }
    if (input === '/') { setSearchMode(true); setSearchCaret(search.length); return }
    if (key.escape) { if (search) { setSearch(''); setSearchCaret(0) } else setExpanded(-1); return }
    if (input === 'o') { setSort(s => (s + 1) % SORTS_FOR.length); resetView(); return }
    if (!tableIsCursor) {
      if (input === 'd') { setView(0); resetView(); return }
      if (input === 'w') { setView(1); resetView(); return }
      if (input === 'm') { setView(2); resetView(); return }
      if (key.leftArrow) { setView(v => (v - 1 + VIEWS.length) % VIEWS.length); resetView(); return }
      if (key.rightArrow) { setView(v => (v + 1) % VIEWS.length); resetView(); return }
      if (key.return) { setExpanded(e => e === cursor ? -1 : cursor); return }
    }
  } else {
    if (key.leftArrow || key.rightArrow) { setTab(t => (t + 1) % TABS.length); resetView(); return }
  }

  if (tab === 1 && !tableIsCursor) {
    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => clampRow(c + 1)); return }
    if (key.pageDown || input === 'G') { setCursor(c => clampRow(input === 'G' ? rowCountRef.current - 1 : c + Math.max(1, rows - 12))); return }
    if (key.pageUp || input === 'g') { setCursor(c => input === 'g' ? 0 : Math.max(0, c - Math.max(1, rows - 12))); return }
  }
}
