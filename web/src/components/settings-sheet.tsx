import { useEffect, useRef, useState } from 'react'
import { type Config, type WebSnapshot } from '@shared'
import { getConfig, putConfig, subscribeConfig } from '../lib/config-client'
import { Check, X } from './icons'
import { FOCUS, useDialogTrap } from './settings/use-dialog-trap'
import { type AccountDraft, newDraft, toDraft } from './settings/account-editor.logic'
import { GeneralSection } from './settings/general-section'
import { ProvidersSection } from './settings/providers-section'
import { AccountsSection } from './settings/accounts-section'
import { AccountEditor } from './settings/account-editor'
import { Segmented } from './ui/controls'

type SettingsTab = 'general' | 'providers' | 'accounts'

const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'providers', label: 'Providers' },
  { value: 'accounts', label: 'Accounts' },
]

export function SettingsSheet({ onClose, snapshot }: { onClose: () => void; snapshot: WebSnapshot | null }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Config | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [acctEditor, setAcctEditor] = useState<AccountDraft | null>(null)
  const [tab, setTab] = useState<SettingsTab>('general')

  useEffect(() => {
    let alive = true
    getConfig()
      .then(c => { if (alive) setDraft(c) })
      .catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : 'load failed') })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (dirty) return
    return subscribeConfig(c => { if (!dirty) setDraft(c) })
  }, [dirty])

  useDialogTrap(panelRef, { active: !acctEditor, onEscape: onClose })

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (acctEditor) panel.setAttribute('inert', '')
    else panel.removeAttribute('inert')
  }, [acctEditor])

  const patch = (fn: (c: Config) => Config) => {
    setDirty(true); setSaveError(null)
    setDraft(c => (c ? fn(c) : c))
  }

  const onSave = async () => {
    if (!draft) return
    setSaving(true); setSaveError(null)
    try {
      const normalized = await putConfig(draft)
      setDraft(normalized)
      setDirty(false)
      onClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="dialog-fade fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-bg-0/70 p-4 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget && !acctEditor) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div ref={panelRef} tabIndex={-1} className="dialog-pop relative my-6 flex w-full max-w-[720px] flex-col overflow-hidden rounded-md border border-line-2 bg-bg-1 focus:outline-none">
        <div className="pointer-events-none absolute left-3 top-2 font-display text-[11px] uppercase tracking-wider text-fg-dim">settings</div>
        <button type="button" onClick={onClose} aria-label="Close" className={`absolute right-2 top-2 z-10 rounded p-1 text-fg-faint transition hover:text-fg ${FOCUS}`}>
          <X className="size-4" />
        </button>

        <div className="max-h-[78vh] overflow-y-auto px-5 pb-4 pt-9">
          {loadError ? (
            <div className="rounded border border-warning/50 bg-bg-2 p-4 text-sm text-warning">{loadError}</div>
          ) : !draft ? (
            <div className="py-10 text-center text-sm text-fg-dim">loading config…</div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
                <Segmented<SettingsTab>
                  size="xs"
                  ariaLabel="settings section"
                  options={SETTINGS_TABS}
                  value={tab}
                  onChange={setTab}
                  containerClassName="flex items-center overflow-hidden rounded border border-line bg-bg-1"
                  btnClassName="px-3 py-1.5 text-[11px] transition"
                />
              </div>
              {tab === 'general' && <GeneralSection draft={draft} patch={patch} />}
              {tab === 'providers' && <ProvidersSection draft={draft} patch={patch} />}
              {tab === 'accounts' && (
                <AccountsSection
                  draft={draft} patch={patch} snapshot={snapshot}
                  onEdit={a => setAcctEditor(toDraft(a))}
                  onConfigure={row => setAcctEditor(newDraft(draft, {
                    providerId: row.providerId,
                    name: row.name,
                    homeDir: row.homeDir,
                    color: row.color,
                  }))}
                  onAdd={() => setAcctEditor(newDraft(draft))}
                />
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3">
          {saveError && <span className="mr-auto text-xs text-warning">{saveError}</span>}
          {dirty && !saveError && <span className="mr-auto text-xs text-fg-faint">unsaved changes</span>}
          <button type="button" onClick={onClose} className={`rounded border border-line bg-bg-1 px-3 py-1.5 text-xs text-fg-dim transition hover:border-line-2 hover:text-fg ${FOCUS}`}>cancel</button>
          <button
            type="button"
            onClick={onSave}
            disabled={!draft || saving || !dirty}
            className={`flex items-center gap-1.5 rounded border border-accent/60 bg-bg-1 px-3 py-1.5 text-xs text-accent transition hover:bg-bg-2 active:scale-[0.97] disabled:opacity-50 ${FOCUS}`}
          >
            <Check className="size-3.5" /> {saving ? 'saving…' : 'save'}
          </button>
        </div>
      </div>

      {acctEditor && draft && (
        <AccountEditor
          editor={acctEditor}
          accounts={draft.accounts}
          onChange={setAcctEditor}
          onCancel={() => setAcctEditor(null)}
          onSubmit={(acct, mode, editingId) => {
            patch(c => mode === 'add'
              ? { ...c, accounts: [...c.accounts, acct] }
              : { ...c, accounts: c.accounts.map(a => a.id === editingId ? acct : a) })
            setAcctEditor(null)
          }}
        />
      )}
    </div>
  )
}
