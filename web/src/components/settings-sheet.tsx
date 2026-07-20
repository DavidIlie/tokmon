import { useCallback, useEffect, useRef, useState } from 'react'
import {
  describeConfigUpdateFailure,
  reconcileSettingsDraft,
  type Config,
  type WebSnapshot,
} from '@shared'
import { getConfig, putConfig, subscribeConfig } from '../lib/config-client'
import { Check } from './icons'
import { Dialog } from './ui/dialog'
import { Button } from './ui/button'
import { FOCUS_RING } from './ui/primitives'
import { type AccountDraft, newDraft, toDraft } from './settings/account-editor.logic'
import { GeneralSection } from './settings/general-section'
import { ProvidersSection } from './settings/providers-section'
import { AccountsSection } from './settings/accounts-section'
import { AccountEditor } from './settings/account-editor'
import { AppSection } from './settings/app-section'
import { ThemeSection } from './settings/theme-section'
import { useTheme } from './theme-provider'
import { validateAppearanceDraft } from '../lib/theme-runtime'

type SettingsTab = 'general' | 'theme' | 'app' | 'providers' | 'accounts'

const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'theme', label: 'Theme' },
  { value: 'app', label: 'Desktop App' },
  { value: 'providers', label: 'Providers' },
  { value: 'accounts', label: 'Accounts' },
]

export function SettingsSheet({ onClose, snapshot }: { onClose: () => void; snapshot: WebSnapshot | null }) {
  const theme = useTheme()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [draft, setDraft] = useState<Config | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [acctEditor, setAcctEditor] = useState<AccountDraft | null>(null)
  const [tab, setTab] = useState<SettingsTab>('general')
  const dirtyRef = useRef(false)
  const confirmDiscardRef = useRef(false)
  const draftRef = useRef<Config | null>(null)
  const revisionRef = useRef<number | null>(null)

  const acceptIncoming = useCallback((state: Awaited<ReturnType<typeof getConfig>>) => {
    setLoadError(null)
    const reconciled = reconcileSettingsDraft(
      draftRef.current,
      revisionRef.current,
      dirtyRef.current,
      state,
    )
    if (!dirtyRef.current) {
      draftRef.current = reconciled.draft
      revisionRef.current = reconciled.revision
      setDraft(reconciled.draft)
      setRevision(reconciled.revision)
    }
    if (reconciled.conflict) {
      setSaveError('settings changed elsewhere; close and reopen settings before saving')
    }
  }, [])

  useEffect(() => {
    let alive = true
    getConfig()
      .then(state => {
        if (!alive) return
        acceptIncoming(state)
      })
      .catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : 'load failed') })
    return () => { alive = false }
  }, [acceptIncoming])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  useEffect(() => {
    let alive = true
    const unsubscribe = subscribeConfig(state => {
      if (!alive) return
      acceptIncoming(state)
    })
    return () => { alive = false; unsubscribe() }
  }, [acceptIncoming])

  const requestClose = () => {
    if (!dirtyRef.current || confirmDiscardRef.current) {
      theme.setPreview(null)
      onClose()
      return
    }
    confirmDiscardRef.current = true
    setConfirmDiscard(true)
    setSaveError('unsaved changes; choose discard to close settings')
  }

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (acctEditor) panel.setAttribute('inert', '')
    else panel.removeAttribute('inert')
  }, [acctEditor])

  const patch = (fn: (c: Config) => Config) => {
    const current = draftRef.current
    if (!current) return
    const next = { ...fn(current), revision: current.revision }
    theme.setPreview(next.appearance)
    dirtyRef.current = true
    draftRef.current = next
    setDirty(true)
    confirmDiscardRef.current = false
    setConfirmDiscard(false)
    setSaveError(null)
    setDraft(next)
  }

  const onSave = async () => {
    if (!draft) return
    setSaving(true); setSaveError(null)
    try {
      if (revision === null) throw new Error('config revision is unavailable')
      const state = await putConfig(draft, revision)
      draftRef.current = state.config
      revisionRef.current = state.config.revision
      dirtyRef.current = false
      setDraft(state.config)
      setRevision(state.config.revision)
      setDirty(false)
      theme.commit(state)
      onClose()
    } catch (e) {
      theme.setPreview(null)
      const failure = describeConfigUpdateFailure(e)
      setSaveError(failure.conflictState
        ? `${failure.message}; close and reopen settings before saving`
        : failure.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog
        onClose={requestClose}
        labelledBy="settings-title"
        initialFocusRef={titleRef}
        panelRef={panelRef}
        className="my-6 flex w-full max-w-[900px] flex-col"
      >
        <h2 ref={titleRef} tabIndex={-1} id="settings-title" className="pointer-events-none absolute left-3 top-2 font-display text-[11px] uppercase tracking-wider text-fg-dim focus:outline-none">settings</h2>

        <div className="max-h-[78vh] overflow-y-auto px-4 pb-4 pt-9 sm:px-5">
          {loadError && !draft ? (
            <div className="rounded border border-critical/50 bg-bg-2 p-4 text-sm text-critical" role="alert">Could not load settings: {loadError}. Close settings and try again.</div>
          ) : !draft ? (
            <div className="py-10 text-center text-sm text-fg-dim">loading config…</div>
          ) : (
            <>
              <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start">
                <nav className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-2 sm:mx-0 sm:w-32 sm:flex-col sm:overflow-visible sm:px-0 sm:pb-0" aria-label="Settings sections">
                  {SETTINGS_TABS.map(item => (
                    <button
                      key={item.value}
                      type="button"
                      aria-current={tab === item.value ? 'page' : undefined}
                      onClick={() => setTab(item.value)}
                      className={`shrink-0 rounded px-2.5 py-2 text-left text-[11px] transition ${FOCUS_RING} ${tab === item.value ? 'bg-bg-3 text-accent' : 'text-fg-dim hover:bg-bg-2 hover:text-fg'}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </nav>
                <div className="min-w-0 flex-1 border-t border-line pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                  {tab === 'general' && <GeneralSection draft={draft} patch={patch} />}
                  {tab === 'theme' && <ThemeSection draft={draft} patch={patch} />}
                  {tab === 'app' && <AppSection draft={draft} patch={patch} snapshot={snapshot} />}
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
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3">
          {saveError && <span className="mr-auto text-xs text-critical" role="alert">{saveError}</span>}
          {dirty && !saveError && <span className="mr-auto text-xs text-fg-faint" role="status" aria-live="polite">unsaved changes</span>}
          <Button variant="secondary" onClick={requestClose}>{confirmDiscard ? 'discard' : 'cancel'}</Button>
          <Button
            variant="primary"
            onClick={onSave}
            disabled={!draft || saving || !dirty || validateAppearanceDraft(draft.appearance).length > 0}
          >
            <Check className="size-3.5" /> {saving ? 'saving…' : 'save'}
          </Button>
        </div>
      </Dialog>

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
    </>
  )
}
