import { useState } from 'react'
import { accountProviderOrdinals, getTrackedAccountRows, PROVIDER_META, projectAccountIdentity, removedRowCopy, setDetectedAccountExcluded, type Account, type Config, type TrackedAccountRow, type WebAccount, type WebSnapshot } from '@shared'
import { namedColorHex } from '../../lib/colors'
import { ChevronUp, ChevronDown, Pencil, Plus, Trash } from '../icons'
import { PrivacyLabel } from '../privacy-label'
import { Button } from '../ui/button'
import { FOCUS_RING } from '../ui/primitives'
import { Section, IconBtn } from './primitives'
import { accountIdentityText } from '../../lib/account-identity'

function accountFromSnapshot(row: TrackedAccountRow, snapshot: WebSnapshot | null): WebAccount | null {
  if (!snapshot) return null
  return snapshot.accounts.find(account => account.id === row.id) ?? null
}

export function AccountsSection({ draft, patch, snapshot, onEdit, onConfigure, onAdd }: {
  draft: Config
  patch: (fn: (c: Config) => Config) => void
  snapshot: WebSnapshot | null
  onEdit: (a: Account) => void
  onConfigure: (row: TrackedAccountRow) => void
  onAdd: () => void
}) {
  const accounts = getTrackedAccountRows(draft, undefined, snapshot?.accounts ?? undefined, snapshot?.suppressedAccounts)
  // Ordinals come from the snapshot's own ordering so they match the ones the
  // daemon baked into identity, not this list's row order.
  const ordinals = accountProviderOrdinals(snapshot?.accounts ?? [])
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const setActive = (id: string | null) => patch(c => ({ ...c, activeAccountId: id }))
  const requestRemove = (id: string) => {
    if (pendingDeleteId !== id) { setPendingDeleteId(id); return }
    patch(c => ({
      ...c,
      accounts: c.accounts.filter(a => a.id !== id),
      activeAccountId: c.activeAccountId === id ? null : c.activeAccountId,
    }))
    setPendingDeleteId(null)
  }
  const move = (idx: number, dir: -1 | 1) => patch(c => {
    const next = [...c.accounts]
    const target = idx + dir
    if (target < 0 || target >= next.length) return c
    ;[next[idx], next[target]] = [next[target], next[idx]]
    return { ...c, accounts: next }
  })

  return (
    <Section title="Accounts" right={
      <Button variant="primary" size="xs" onClick={onAdd}>
        <Plus className="size-3" /> Add account
      </Button>
    }>
      <p className="mb-2.5 text-[11px] text-fg-faint">
        Remove one detected account from Tokmon without changing its files or login. Removed accounts stay restorable here.
      </p>
      {accounts.length === 0 ? (
        <p className="rounded border border-line bg-bg-2/50 px-3 py-3 text-xs text-fg-faint">
          None configured — enabled providers track automatically.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label="Active account">
          {accounts.map(acc => {
            const meta = PROVIDER_META[acc.providerId]
            const live = accountFromSnapshot(acc, snapshot)
            const visible = live ? accountIdentityText(live, meta.name) : acc.name || meta.name
            // The draft's privacy mode can be ahead of the snapshot it is
            // reading, so the label is re-projected here rather than trusted.
            const identity = projectAccountIdentity({
              identity: live?.identity,
              visible,
              providerName: meta.name,
              ordinal: ordinals.get(acc.id) ?? 1,
              privacyMode: draft.privacyMode,
            })
            const plan = live?.plan ?? live?.billing?.plan ?? null
            const hex = namedColorHex(acc.color || meta.color)
            const active = acc.enabled && acc.id === draft.activeAccountId
            const configured = acc.source === 'configured'
            const ignored = acc.source === 'ignored'
            return (
              <li key={`${acc.source}:${acc.id}`} className={`flex items-center gap-2.5 rounded border border-line px-2.5 py-2 ${ignored ? 'bg-bg-1 opacity-75' : 'bg-bg-2/60'}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={ignored || !acc.enabled}
                  aria-label={`Set ${identity} active`}
                  title={active ? 'Active account (click to clear)' : 'Set active'}
                  onClick={() => setActive(active ? null : acc.id)}
                  className={`relative inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition ${FOCUS_RING}`}
                  style={{ borderColor: hex }}
                >
                  {active && <span className="size-2 rounded-full" style={{ background: hex }} />}
                </button>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: hex }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <PrivacyLabel value={visible} projected={identity} privacyMode={draft.privacyMode} className="truncate text-sm text-fg-bright" />
                    <span className="shrink-0 rounded bg-bg-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-dim">{meta.name}</span>
                    {plan && (
                      <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-fg-dim">{plan}</span>
                    )}
                    <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-faint">
                      {acc.source === 'auto' ? 'detected' : ignored ? (acc.live === false ? 'source not found' : 'removed') : acc.enabled ? 'manual' : 'manual · disabled'}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-fg-faint">{draft.privacyMode ? 'path hidden' : acc.homeDir}</div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {pendingDeleteId === acc.id ? <span className="mr-1 text-[10px] text-critical" role="alert">Delete?</span> : null}
                  {configured && acc.explicitIndex !== undefined ? (
                    <>
                      <IconBtn label="Move up" disabled={acc.explicitIndex === 0} onClick={() => move(acc.explicitIndex!, -1)}><ChevronUp className="size-3.5" /></IconBtn>
                      <IconBtn label="Move down" disabled={acc.explicitIndex === draft.accounts.length - 1} onClick={() => move(acc.explicitIndex!, 1)}><ChevronDown className="size-3.5" /></IconBtn>
                      <IconBtn label="Edit account" onClick={() => onEdit(acc)}><Pencil className="size-3.5" /></IconBtn>
                      <Button size="xs" onClick={() => patch(c => ({
                        ...c,
                        activeAccountId: !acc.enabled || c.activeAccountId !== acc.id ? c.activeAccountId : null,
                        accounts: c.accounts.map(account =>
                          account.id === acc.id ? { ...account, enabled: !acc.enabled } : account),
                      }))}>{acc.enabled ? 'Disable' : 'Enable'}</Button>
                      <IconBtn label={pendingDeleteId === acc.id ? 'Confirm delete account' : 'Delete account'} danger onClick={() => requestRemove(acc.id)}><Trash className="size-3.5" /></IconBtn>
                    </>
                  ) : ignored ? (
                    <Button size="xs" aria-label={`${removedRowCopy(acc.live).action} ${identity}`} onClick={() => acc.excludedRef && patch(c => ({
                      ...c,
                      accountDetection: setDetectedAccountExcluded(c.accountDetection, acc.excludedRef!, false),
                    }))}>{removedRowCopy(acc.live).action}</Button>
                  ) : (<>
                    <IconBtn label="Configure as manual account" onClick={() => onConfigure(acc)}><Pencil className="size-3.5" /></IconBtn>
                    <Button size="xs" aria-label={`Remove ${identity} from Tokmon`} onClick={() => patch(c => ({
                      ...c,
                      activeAccountId: c.activeAccountId === acc.id ? null : c.activeAccountId,
                      accountDetection: setDetectedAccountExcluded(c.accountDetection, { providerId: acc.providerId, homeDir: acc.homeDir }, true),
                    }))}>Remove</Button>
                  </>)}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
