import { useState, useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  generateAccountId, pickAccentColor,
  type Config, type Account as StoredAccount, type TrackedAccountRow,
} from '../../config'
import { PROVIDERS, PROVIDER_ORDER, type ProviderId } from '../../providers'
import { COLOR_PALETTE, FORM_FIELDS, type AccountForm } from '../settings'

export function useAccountForm({ cfg, detected, updateConfig, trackedAccountRows, setSettingsCursor }: {
  cfg: Config
  detected: ProviderId[]
  updateConfig: (fn: (prev: Config) => Config) => void
  trackedAccountRows: TrackedAccountRow[]
  setSettingsCursor: Dispatch<SetStateAction<number>>
}): {
  accountForm: AccountForm | null
  setAccountForm: Dispatch<SetStateAction<AccountForm | null>>
  openAddAccount: (defaults?: Pick<TrackedAccountRow, 'providerId' | 'name' | 'homeDir' | 'color'>) => void
  openConfigureAccount: (row: TrackedAccountRow) => void
  openEditAccount: (acc: StoredAccount) => void
  commitAccountForm: () => void
  cycleFormField: (dir: 1 | -1) => void
  cycleProvider: (dir: 1 | -1) => void
  cycleColor: (dir: 1 | -1) => void
  deleteAccount: (id: string) => void
  moveAccount: (idx: number, dir: -1 | 1) => void
} {
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null)

  function openAddAccount(defaults?: Pick<TrackedAccountRow, 'providerId' | 'name' | 'homeDir' | 'color'>): void {
    const providerId = defaults?.providerId ?? ((detected[0] ?? 'claude') as ProviderId)
    setAccountForm({
      mode: 'add', field: 'provider', providerId,
      name: defaults?.name ?? '', homeDir: defaults?.homeDir ?? '~', color: defaults?.color ?? pickAccentColor(cfg.accounts),
      caret: defaults?.name?.length ?? 0,
      editingId: null, error: null,
    })
  }
  function openConfigureAccount(row: TrackedAccountRow): void {
    openAddAccount(row)
  }
  function openEditAccount(acc: StoredAccount): void {
    setAccountForm({
      mode: 'edit', field: 'provider', providerId: acc.providerId,
      name: acc.name, homeDir: acc.homeDir, color: acc.color || PROVIDERS[acc.providerId].color,
      caret: acc.name.length,
      editingId: acc.id, error: null,
    })
  }
  function commitAccountForm(): void {
    if (!accountForm) return
    const name = accountForm.name.trim()
    const homeDir = accountForm.homeDir.trim() || '~'
    if (!name) { setAccountForm({ ...accountForm, error: 'Name required', field: 'name', caret: accountForm.name.length }); return }
    updateConfig(c => {
      if (accountForm.mode === 'add') {
        const id = generateAccountId(name, c.accounts)
        const account: StoredAccount = { id, providerId: accountForm.providerId, name, homeDir, color: accountForm.color }
        return { ...c, accounts: [...c.accounts, account] }
      }
      return {
        ...c,
        accounts: c.accounts.map(a =>
          a.id === accountForm.editingId
            ? { ...a, providerId: accountForm.providerId, name, homeDir, color: accountForm.color }
            : a),
      }
    })
    setAccountForm(null)
  }
  const cycleFormField = useCallback((dir: 1 | -1): void => {
    setAccountForm(f => {
      if (!f) return f
      const i = FORM_FIELDS.indexOf(f.field)
      const next = FORM_FIELDS[(i + dir + FORM_FIELDS.length) % FORM_FIELDS.length]
      const caret = next === 'name' ? f.name.length : next === 'homeDir' ? f.homeDir.length : f.caret
      return { ...f, field: next, caret }
    })
  }, [])
  const cycleProvider = useCallback((dir: 1 | -1): void => {
    setAccountForm(f => {
      if (!f) return f
      const i = PROVIDER_ORDER.indexOf(f.providerId)
      return { ...f, providerId: PROVIDER_ORDER[(i + dir + PROVIDER_ORDER.length) % PROVIDER_ORDER.length] }
    })
  }, [])
  const cycleColor = useCallback((dir: 1 | -1): void => {
    setAccountForm(f => {
      if (!f) return f
      const i = COLOR_PALETTE.indexOf(f.color as typeof COLOR_PALETTE[number])
      const idx = i < 0 ? 0 : i
      return { ...f, color: COLOR_PALETTE[(idx + dir + COLOR_PALETTE.length) % COLOR_PALETTE.length] }
    })
  }, [])
  function deleteAccount(id: string): void {
    updateConfig(c => ({
      ...c,
      accounts: c.accounts.filter(a => a.id !== id),
      activeAccountId: c.activeAccountId === id ? null : c.activeAccountId,
    }))
  }
  function moveAccount(idx: number, dir: -1 | 1): void {
    updateConfig(c => {
      const next = [...c.accounts]
      const target = idx + dir
      if (target < 0 || target >= next.length) return c
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return { ...c, accounts: next }
    })
    setSettingsCursor(c => Math.max(0, Math.min(trackedAccountRows.length - 1, c + dir)))
  }

  return {
    accountForm, setAccountForm,
    openAddAccount, openConfigureAccount, openEditAccount, commitAccountForm,
    cycleFormField, cycleProvider, cycleColor, deleteAccount, moveAccount,
  }
}
