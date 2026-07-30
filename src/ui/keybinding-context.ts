import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ProviderId } from '../providers'
import type { Config, Account as StoredAccount, TrackedAccountRow } from '../config'
import type { Slot } from './app.logic'
import type { AccountForm, SettingsTab } from './settings'

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
  onboarding: {
    show: boolean
    providers: ProviderId[]
    cursor: number
    setCursor: Dispatch<SetStateAction<number>>
    toggle: (i: number) => void
    confirm: () => void
  }
  accountEditor: {
    form: AccountForm | null
    setForm: Dispatch<SetStateAction<AccountForm | null>>
    commit: () => void
    cycleField: (dir: 1 | -1) => void
    cycleProvider: (dir: 1 | -1) => void
    cycleColor: (dir: 1 | -1) => void
  }
  timezoneEditor: {
    value: string | null
    setValue: Dispatch<SetStateAction<string | null>>
    setError: Dispatch<SetStateAction<string | null>>
    setCaret: Dispatch<SetStateAction<number>>
    valueRef: MutableRefObject<string>
    caretRef: MutableRefObject<number>
  }
  allowedHostsEditor: {
    value: string | null
    setValue: Dispatch<SetStateAction<string | null>>
    setError: Dispatch<SetStateAction<string | null>>
    setCaret: Dispatch<SetStateAction<number>>
    valueRef: MutableRefObject<string>
    caretRef: MutableRefObject<number>
  }
  textInput: {
    isPrintable: (input: string, key: { ctrl: boolean; meta: boolean }) => boolean
    insert: (text: string) => void
  }
  settings: {
    show: boolean
    setShow: Dispatch<SetStateAction<boolean>>
    cursor: number
    tab: SettingsTab
    setTab: Dispatch<SetStateAction<SettingsTab>>
    setCursor: Dispatch<SetStateAction<number>>
    trackedAccounts: TrackedAccountRow[]
    moveAccount: (idx: number, dir: -1 | 1) => void
    toggleProvider: (pid: ProviderId) => void
    openEditAccount: (acc: StoredAccount) => void
    openConfigureAccount: (row: TrackedAccountRow) => void
    deleteAccount: (id: string) => void
    openAddAccount: () => void
  }
  table: {
    tab: number
    searchMode: boolean
    setSearchMode: Dispatch<SetStateAction<boolean>>
    search: string
    setSearch: Dispatch<SetStateAction<string>>
    setSearchCaret: Dispatch<SetStateAction<number>>
    searchValueRef: MutableRefObject<string>
    searchCaretRef: MutableRefObject<number>
    cycleProvider: (dir: 1 | -1) => void
    setExpanded: Dispatch<SetStateAction<number>>
    setSort: Dispatch<SetStateAction<number>>
    sorts: readonly { label: string; dir: 'up' | 'down' | null }[]
    cycleModel: (dir: 1 | -1) => void
    setView: Dispatch<SetStateAction<number>>
    cursor: number
    rowCountRef: MutableRefObject<number>
    rows: number
    setCursor: Dispatch<SetStateAction<number>>
    clampRow: (n: number) => number
  }
  dashboard: {
    paginated: boolean
    pageCount: number
    setPage: Dispatch<SetStateAction<number>>
  }
  global: {
    exit: () => void
    showLoader: boolean
    configReady: boolean
    toggleWeb: () => Promise<void>
    config: Config
    updateConfig: (fn: (prev: Config) => Config) => void
    cycleAccount: (dir: 1 | -1) => void
    setTab: Dispatch<SetStateAction<number>>
    resetView: () => void
    slots: Slot[]
    refreshAll: () => void
  }
}
