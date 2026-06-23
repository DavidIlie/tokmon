import { PROVIDER_META, type Account, type Config } from '@shared'
import { namedColorHex } from '../../lib/colors'
import { ChevronUp, ChevronDown, Pencil, Plus, Trash } from '../icons'
import { FOCUS } from './use-dialog-trap'
import { Section, IconBtn } from './primitives'

export function AccountsSection({ draft, patch, onEdit, onAdd }: {
  draft: Config
  patch: (fn: (c: Config) => Config) => void
  onEdit: (a: Account) => void
  onAdd: () => void
}) {
  const accounts = draft.accounts

  const setActive = (id: string | null) => patch(c => ({ ...c, activeAccountId: id }))
  const remove = (id: string) => patch(c => ({
    ...c,
    accounts: c.accounts.filter(a => a.id !== id),
    activeAccountId: c.activeAccountId === id ? null : c.activeAccountId,
  }))
  const move = (idx: number, dir: -1 | 1) => patch(c => {
    const next = [...c.accounts]
    const target = idx + dir
    if (target < 0 || target >= next.length) return c
    ;[next[idx], next[target]] = [next[target], next[idx]]
    return { ...c, accounts: next }
  })

  return (
    <Section title="Accounts" right={
      <button type="button" onClick={onAdd}
        className={`flex items-center gap-1 rounded border border-accent/60 bg-bg-1 px-2 py-1 text-[11px] text-accent transition hover:bg-bg-2 ${FOCUS}`}>
        <Plus className="size-3" /> Add account
      </button>
    }>
      {accounts.length === 0 ? (
        <p className="rounded border border-line bg-bg-2/50 px-3 py-3 text-xs text-fg-faint">
          None configured — enabled providers track automatically.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label="Active account">
          {accounts.map((acc, i) => {
            const meta = PROVIDER_META[acc.providerId]
            const hex = namedColorHex(acc.color || meta.color)
            const active = acc.id === draft.activeAccountId
            return (
              <li key={acc.id} className="flex items-center gap-2.5 rounded border border-line bg-bg-2/60 px-2.5 py-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`Set ${acc.name} active`}
                  title={active ? 'Active account (click to clear)' : 'Set active'}
                  onClick={() => setActive(active ? null : acc.id)}
                  className={`relative inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition ${FOCUS}`}
                  style={{ borderColor: hex }}
                >
                  {active && <span className="size-2 rounded-full" style={{ background: hex }} />}
                </button>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: hex }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-fg-bright">{acc.name}</span>
                    <span className="shrink-0 rounded bg-bg-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-dim">{meta.name}</span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-fg-faint">{acc.homeDir}</div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp className="size-3.5" /></IconBtn>
                  <IconBtn label="Move down" disabled={i === accounts.length - 1} onClick={() => move(i, 1)}><ChevronDown className="size-3.5" /></IconBtn>
                  <IconBtn label="Edit account" onClick={() => onEdit(acc)}><Pencil className="size-3.5" /></IconBtn>
                  <IconBtn label="Delete account" danger onClick={() => remove(acc.id)}><Trash className="size-3.5" /></IconBtn>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
