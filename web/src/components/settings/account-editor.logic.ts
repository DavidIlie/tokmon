import {
  generateAccountId, pickAccentColor,
  COLOR_PALETTE, PROVIDER_META, PROVIDER_ORDER,
  type Account, type Config, type ProviderId,
} from '@shared'

export interface AccountDraft {
  mode: 'add' | 'edit'
  editingId: string | null
  providerId: ProviderId
  name: string
  homeDir: string
  color: string
}

export interface AccountDraftDefaults {
  providerId?: ProviderId
  name?: string
  homeDir?: string
  color?: string
}

export function newDraft(cfg: Config, defaults: AccountDraftDefaults = {}): AccountDraft {
  return {
    mode: 'add', editingId: null,
    providerId: defaults.providerId ?? PROVIDER_ORDER[0],
    name: defaults.name ?? '',
    homeDir: defaults.homeDir ?? '~',
    color: defaults.color ?? pickAccentColor(cfg.accounts),
  }
}

export function toDraft(a: Account): AccountDraft {
  return {
    mode: 'edit', editingId: a.id,
    providerId: a.providerId,
    name: a.name, homeDir: a.homeDir,
    color: a.color || PROVIDER_META[a.providerId].color,
  }
}

export function previewAccountId(editor: AccountDraft, accounts: Account[]): string {
  const others = editor.mode === 'edit' ? accounts.filter(a => a.id !== editor.editingId) : accounts
  return editor.mode === 'edit'
    ? (editor.editingId ?? '')
    : generateAccountId(editor.name.trim() || 'account', others)
}

export type BuildAccountResult =
  | { ok: true; account: Account; mode: 'add' | 'edit'; editingId: string | null }
  | { ok: false; error: string }

export function buildAccountFromDraft(editor: AccountDraft, accounts: Account[]): BuildAccountResult {
  const name = editor.name.trim()
  const homeDir = editor.homeDir.trim() || '~'
  if (!name) return { ok: false, error: 'Name required' }
  if (editor.mode === 'add') {
    const id = generateAccountId(name, accounts)
    return { ok: true, account: { id, providerId: editor.providerId, name, homeDir, color: editor.color }, mode: 'add', editingId: null }
  }
  return {
    ok: true,
    account: { id: editor.editingId!, providerId: editor.providerId, name, homeDir, color: editor.color },
    mode: 'edit',
    editingId: editor.editingId,
  }
}

export { COLOR_PALETTE }
