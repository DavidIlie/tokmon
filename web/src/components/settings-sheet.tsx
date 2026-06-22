import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  generateAccountId, pickAccentColor, sanitizeTyped, isValidTimezone,
  COLOR_PALETTE, PROVIDER_META, PROVIDER_ORDER,
  type Account, type Config, type ProviderId,
} from '@shared'
import { getConfig, listDir, putConfig, subscribeConfig, type FsListing } from '../lib/config-client'
import { namedColorHex } from '../lib/colors'
import {
  displayFolderPath, normalizeBrowseStartPath, rowsForListing,
  type FolderPickerRow,
} from '../lib/folder-picker.logic'
import { Check, ChevronUp, ChevronDown, Folder, Pencil, Plus, Trash, X } from './icons'
import { Segmented } from './ui'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent'
const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'

function useDialogTrap(
  panelRef: React.RefObject<HTMLElement>,
  { active, onEscape, initialFocusRef }: {
    active: boolean
    onEscape: () => void
    initialFocusRef?: React.RefObject<HTMLElement>
  },
) {
  useEffect(() => {
    if (!active) return
    const prev = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(initialFocusRef?.current ?? firstFocusable ?? panel)?.focus?.()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onEscape(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const f = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      const vis = Array.from(f).filter(el => el.offsetParent !== null || el === document.activeElement)
      if (vis.length === 0) return
      const first = vis[0], last = vis[vis.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}

interface AccountDraft {
  mode: 'add' | 'edit'
  editingId: string | null
  providerId: ProviderId
  name: string
  homeDir: string
  color: string
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Config | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [acctEditor, setAcctEditor] = useState<AccountDraft | null>(null)

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
              <GeneralSection draft={draft} patch={patch} />
              <ProvidersSection draft={draft} patch={patch} />
              <AccountsSection
                draft={draft} patch={patch}
                onEdit={a => setAcctEditor(toDraft(a))}
                onAdd={() => setAcctEditor(newDraft(draft))}
              />
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

function GeneralSection({ draft, patch }: { draft: Config; patch: (fn: (c: Config) => Config) => void }) {
  return (
    <Section title="General">
      <FieldRow label="Refresh interval" hint="dashboard poll, seconds">
        <NumberStepper value={draft.interval} min={1} unit="s" onChange={v => patch(c => ({ ...c, interval: v }))} />
      </FieldRow>
      <FieldRow label="Billing poll" hint="billing refresh, minutes">
        <NumberStepper value={draft.billingInterval} min={1} unit="m" onChange={v => patch(c => ({ ...c, billingInterval: v }))} />
      </FieldRow>
      <FieldRow label="Clear screen" hint="redraw on each refresh">
        <Segmented<'on' | 'off'> size="xs" ariaLabel="clear screen"
          options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]}
          value={draft.clearScreen ? 'on' : 'off'} onChange={v => patch(c => ({ ...c, clearScreen: v === 'on' }))} />
      </FieldRow>
      <FieldRow label="Timezone" hint="IANA name · empty = System">
        <TimezoneField value={draft.timezone} onChange={tz => patch(c => ({ ...c, timezone: tz }))} />
      </FieldRow>
      <FieldRow label="Dashboard" hint="grid shows all · single cycles">
        <Segmented<'grid' | 'single'> size="xs" ariaLabel="dashboard layout"
          options={[{ value: 'grid', label: 'grid' }, { value: 'single', label: 'single' }]}
          value={draft.dashboardLayout} onChange={v => patch(c => ({ ...c, dashboardLayout: v }))} />
      </FieldRow>
      <FieldRow label="Default focus" hint="on open">
        <Segmented<'all' | 'last'> size="xs" ariaLabel="default focus"
          options={[{ value: 'all', label: 'all' }, { value: 'last', label: 'last' }]}
          value={draft.defaultFocus} onChange={v => patch(c => ({ ...c, defaultFocus: v }))} />
      </FieldRow>
      <FieldRow label="ASCII mode" hint="glyph fallback">
        <Segmented<'auto' | 'on' | 'off'> size="xs" ariaLabel="ascii mode"
          options={[{ value: 'auto', label: 'auto' }, { value: 'on', label: 'on' }, { value: 'off', label: 'off' }]}
          value={draft.ascii} onChange={v => patch(c => ({ ...c, ascii: v }))} />
      </FieldRow>
    </Section>
  )
}

function TimezoneField({ value, onChange }: { value: string | null; onChange: (tz: string | null) => void }) {
  const [text, setText] = useState(value ?? '')
  const [error, setError] = useState(false)

  useEffect(() => { setText(value ?? ''); setError(false) }, [value])

  const onInput = (raw: string) => {
    const v = sanitizeTyped(raw)
    setText(v)
    const trimmed = v.trim()
    if (!trimmed) { setError(false); onChange(null); return }
    if (isValidTimezone(trimmed)) { setError(false); onChange(trimmed) }
    else setError(true)
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        type="text"
        value={text}
        placeholder="System"
        spellCheck={false}
        aria-invalid={error}
        onChange={e => onInput(e.target.value)}
        className={`w-44 rounded border bg-bg-2 px-2 py-1 text-xs text-fg ${FOCUS} ${error ? 'border-warning' : 'border-line'}`}
      />
      {error && <span className="text-[10px] text-warning">invalid timezone</span>}
    </div>
  )
}

function ProvidersSection({ draft, patch }: { draft: Config; patch: (fn: (c: Config) => Config) => void }) {
  const toggle = (pid: ProviderId, enabled: boolean) =>
    patch(c => ({
      ...c,
      disabledProviders: enabled
        ? c.disabledProviders.filter(p => p !== pid)
        : Array.from(new Set([...c.disabledProviders, pid])),
    }))
  return (
    <Section title="Providers">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {PROVIDER_ORDER.map(pid => {
          const enabled = !draft.disabledProviders.includes(pid)
          const meta = PROVIDER_META[pid]
          return (
            <button
              key={pid}
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => toggle(pid, !enabled)}
              className={`flex items-center gap-2.5 rounded border px-3 py-2 text-left text-xs transition ${FOCUS} ${
                enabled ? 'border-line-2 bg-bg-2 text-fg' : 'border-line bg-bg-1 text-fg-faint hover:border-line-2'
              }`}
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border"
                style={{ borderColor: enabled ? namedColorHex(meta.color) : 'var(--color-line-2)', background: enabled ? namedColorHex(meta.color) : 'transparent' }}>
                {enabled && <Check className="size-3 text-bg-0" />}
              </span>
              <span className="size-2 shrink-0 rounded-full" style={{ background: namedColorHex(meta.color) }} aria-hidden />
              <span className={`font-medium ${enabled ? 'text-fg' : 'text-fg-faint'}`}>{meta.name}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-fg-faint">{enabled ? 'tracking' : 'off'}</span>
            </button>
          )
        })}
      </div>
    </Section>
  )
}

function AccountsSection({ draft, patch, onEdit, onAdd }: {
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

function AccountEditor({ editor, accounts, onChange, onCancel, onSubmit }: {
  editor: AccountDraft
  accounts: Account[]
  onChange: (d: AccountDraft) => void
  onCancel: () => void
  onSubmit: (acct: Account, mode: 'add' | 'edit', editingId: string | null) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const accent = namedColorHex(editor.color)

  useDialogTrap(editorRef, { active: true, onEscape: onCancel, initialFocusRef: nameRef })

  const others = editor.mode === 'edit' ? accounts.filter(a => a.id !== editor.editingId) : accounts
  const previewId = editor.mode === 'edit'
    ? (editor.editingId ?? '')
    : generateAccountId(editor.name.trim() || 'account', others)

  const submit = () => {
    const name = editor.name.trim()
    const homeDir = editor.homeDir.trim() || '~'
    if (!name) { setError('Name required'); return }
    if (editor.mode === 'add') {
      const id = generateAccountId(name, accounts)
      onSubmit({ id, providerId: editor.providerId, name, homeDir, color: editor.color }, 'add', null)
    } else {
      onSubmit(
        { id: editor.editingId!, providerId: editor.providerId, name, homeDir, color: editor.color },
        'edit', editor.editingId,
      )
    }
  }

  return (
    <div
      className="dialog-fade fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-bg-0/60 p-4 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
      role="dialog"
      aria-modal="true"
      aria-label={editor.mode === 'add' ? 'New account' : 'Edit account'}
    >
      <div ref={editorRef} tabIndex={-1} className="dialog-pop my-8 w-full max-w-[460px] overflow-hidden rounded-md border-l-2 border border-line-2 bg-bg-1 focus:outline-none"
        style={{ borderLeftColor: accent }}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="size-2.5 rounded-full" style={{ background: accent }} aria-hidden />
          <span className="font-display text-xs uppercase tracking-wider text-fg-bright">
            {editor.mode === 'add' ? 'New account' : 'Edit account'}
          </span>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          <Field label="Provider" hint="which tool this account tracks">
            <div className="flex flex-wrap gap-1.5">
              {PROVIDER_ORDER.map(pid => {
                const sel = pid === editor.providerId
                const meta = PROVIDER_META[pid]
                return (
                  <button key={pid} type="button"
                    onClick={() => onChange({ ...editor, providerId: pid })}
                    aria-pressed={sel}
                    className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition ${FOCUS} ${
                      sel ? 'border-line-2 bg-bg-3 text-fg-bright' : 'border-line text-fg-dim hover:text-fg'
                    }`}>
                    <span className="size-2 rounded-full" style={{ background: namedColorHex(meta.color) }} aria-hidden />
                    {meta.name}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Name" hint="display name for this account">
            <input
              ref={nameRef}
              type="text"
              value={editor.name}
              placeholder="e.g. Work, Personal"
              spellCheck={false}
              onChange={e => { setError(null); onChange({ ...editor, name: sanitizeTyped(e.target.value) }) }}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              className={`w-full rounded border border-line bg-bg-2 px-2.5 py-1.5 text-sm text-fg ${FOCUS}`}
            />
          </Field>

          <Field label="Home directory" hint="path containing the tool's data dir · ~ for default">
            <HomeDirectoryField
              value={editor.homeDir}
              onChange={homeDir => onChange({ ...editor, homeDir })}
              onEnter={submit}
            />
          </Field>

          <Field label="Accent color" hint="shows on dashboard, account strip, borders">
            <div className="flex flex-wrap gap-1.5">
              {COLOR_PALETTE.map(c => {
                const sel = c === editor.color
                return (
                  <button key={c} type="button"
                    aria-label={c} aria-pressed={sel} title={c}
                    onClick={() => onChange({ ...editor, color: c })}
                    className={`size-6 rounded-full border-2 transition ${FOCUS} ${sel ? 'scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ background: namedColorHex(c), borderColor: sel ? 'var(--color-fg-bright)' : 'transparent' }}
                  />
                )
              })}
            </div>
          </Field>

          <div className="flex items-center gap-2 rounded border border-line bg-bg-2/50 px-2.5 py-1.5 text-xs">
            <span className="text-fg-faint">id</span>
            <span className="font-mono text-fg" style={{ color: accent }}>{previewId || 'account'}</span>
            <span className="ml-auto text-[10px] text-fg-faint">{editor.mode === 'add' ? 'auto-generated from name' : 'fixed'}</span>
          </div>

          {error && <p className="text-xs text-warning">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onCancel} className={`rounded border border-line bg-bg-1 px-3 py-1.5 text-xs text-fg-dim transition hover:border-line-2 hover:text-fg ${FOCUS}`}>cancel</button>
          <button type="button" onClick={submit} className={`flex items-center gap-1.5 rounded border border-accent/60 bg-bg-1 px-3 py-1.5 text-xs text-accent transition hover:bg-bg-2 active:scale-[0.97] ${FOCUS}`}>
            <Check className="size-3.5" /> {editor.mode === 'add' ? 'Add account' : 'Save account'}
          </button>
        </div>
      </div>
    </div>
  )
}

function HomeDirectoryField({ value, onChange, onEnter }: {
  value: string
  onChange: (value: string) => void
  onEnter: () => void
}) {
  const [open, setOpen] = useState(false)
  const [listing, setListing] = useState<FsListing | null>(null)
  const [requestedPath, setRequestedPath] = useState('~')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const browse = useCallback(async (path: string) => {
    const id = ++requestId.current
    const start = normalizeBrowseStartPath(path)
    setRequestedPath(start)
    setLoading(true)
    setError(null)
    try {
      const next = await listDir(start)
      if (id !== requestId.current) return
      setListing(next)
    } catch (e) {
      if (id !== requestId.current) return
      setListing(null)
      setError(e instanceof Error ? e.message : 'cannot read folder')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => () => { requestId.current++ }, [])

  const openPicker = () => {
    setOpen(true)
    void browse(value)
  }

  const closePicker = () => {
    requestId.current++
    setOpen(false)
    setLoading(false)
    setError(null)
  }

  const navigate = (path: string) => {
    if (loading) return
    void browse(path)
  }

  const selectCurrent = () => {
    if (!listing || loading) return
    onChange(displayFolderPath(listing.path))
    closePicker()
  }

  const rows: FolderPickerRow[] = listing ? rowsForListing(listing) : []
  const directoryRows = rows.filter(row => row.kind === 'entry')
  const currentPath = displayFolderPath(listing?.path ?? requestedPath)

  return (
    <div className="relative">
      <div className="flex overflow-hidden rounded border border-line bg-bg-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
          <Folder className="size-4 shrink-0 text-fg-faint" />
          <input
            type="text"
            value={value}
            placeholder="~"
            spellCheck={false}
            onChange={e => { closePicker(); onChange(sanitizeTyped(e.target.value)) }}
            onKeyDown={e => { if (e.key === 'Enter') onEnter() }}
            className={`min-w-0 flex-1 bg-transparent py-1.5 font-mono text-sm text-fg ${FOCUS}`}
          />
        </div>
        <button
          type="button"
          onClick={openPicker}
          disabled={loading}
          className={`flex shrink-0 items-center gap-1 border-l border-line bg-bg-1 px-2.5 py-1.5 text-xs text-fg-dim transition hover:bg-bg-3 hover:text-fg disabled:opacity-50 ${FOCUS}`}
        >
          <ChevronDown className="size-3.5" /> Browse
        </button>
      </div>

      {open && (
        <div className="mt-2 overflow-hidden rounded border border-line-2 bg-bg-1 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-2 border-b border-line bg-bg-2 px-2.5 py-2">
            <Folder className="size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 truncate font-mono text-xs text-fg-bright" title={currentPath}>
              {currentPath}
            </div>
            {loading && <span className="shrink-0 text-[10px] uppercase tracking-wide text-fg-faint">loading</span>}
            <button type="button" onClick={closePicker} aria-label="Close folder picker" className={`rounded p-1 text-fg-faint transition hover:text-fg ${FOCUS}`}>
              <X className="size-3.5" />
            </button>
          </div>

          {error ? (
            <div className="px-2.5 py-3">
              <div className="text-xs text-warning">can't read {displayFolderPath(requestedPath)}</div>
              <button
                type="button"
                onClick={() => { if (!loading) void browse(requestedPath) }}
                disabled={loading}
                className={`mt-2 rounded border border-line bg-bg-2 px-2 py-1 text-[11px] text-fg-dim transition hover:border-line-2 hover:text-fg disabled:opacity-50 ${FOCUS}`}
              >
                retry
              </button>
            </div>
          ) : (
            <>
              <div className="max-h-56 overflow-y-auto py-1">
                {rows.map(row => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => navigate(row.path)}
                    disabled={loading}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-bg-3 hover:text-fg disabled:opacity-50 ${FOCUS} ${
                      row.kind === 'parent' ? 'text-fg-dim' : 'text-fg'
                    }`}
                  >
                    {row.kind === 'parent'
                      ? <ChevronUp className="size-3.5 shrink-0" />
                      : <Folder className="size-3.5 shrink-0 text-fg-faint" />}
                    <span className="min-w-0 truncate font-mono">{row.label}</span>
                  </button>
                ))}
                {!loading && directoryRows.length === 0 && (
                  <div className="px-2.5 py-3 text-xs text-fg-faint">no subdirectories</div>
                )}
                {loading && !listing && (
                  <div className="px-2.5 py-3 text-xs text-fg-faint">loading folders...</div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-line px-2.5 py-2">
                <button
                  type="button"
                  onClick={selectCurrent}
                  disabled={!listing || loading}
                  className={`flex items-center gap-1.5 rounded border border-accent/60 bg-bg-1 px-2.5 py-1.5 text-xs text-accent transition hover:bg-bg-2 active:scale-[0.97] disabled:opacity-50 ${FOCUS}`}
                >
                  <Check className="size-3.5" /> Select this folder
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function newDraft(cfg: Config): AccountDraft {
  return {
    mode: 'add', editingId: null,
    providerId: PROVIDER_ORDER[0],
    name: '', homeDir: '~',
    color: pickAccentColor(cfg.accounts),
  }
}
function toDraft(a: Account): AccountDraft {
  return {
    mode: 'edit', editingId: a.id,
    providerId: a.providerId,
    name: a.name, homeDir: a.homeDir,
    color: a.color || PROVIDER_META[a.providerId].color,
  }
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-2.5 flex items-center gap-2 border-b border-line pb-1.5">
        <h3 className="font-display text-[11px] uppercase tracking-wider text-fg-dim">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  )
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg">{label}</div>
        {hint && <div className="text-[11px] text-fg-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-fg">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-fg-faint">{hint}</div>}
    </div>
  )
}

function NumberStepper({ value, min, unit, onChange }: { value: number; min: number; unit: string; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(min, Math.round(v)))
  const [buf, setBuf] = useState<string | null>(null)
  const commit = () => {
    if (buf === null) return
    const n = Number(buf)
    set(Number.isFinite(n) && buf.trim() !== '' ? n : min)
    setBuf(null)
  }
  return (
    <div className="flex items-center overflow-hidden rounded border border-line">
      <button type="button" aria-label="decrease" onClick={() => set(value - 1)} className={`px-2 py-1 text-xs text-fg-dim transition hover:bg-bg-3 hover:text-fg ${FOCUS}`}>−</button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={buf ?? value}
        onChange={e => {
          const v = e.target.value
          setBuf(v)
          const n = Number(v)
          if (v.trim() !== '' && Number.isFinite(n) && n >= min) set(n)
        }}
        onBlur={commit}
        aria-label={`value (${unit})`}
        className={`tnum w-12 border-x border-line bg-bg-2 px-1 py-1 text-center text-xs text-fg ${FOCUS} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <span className="px-1.5 text-[10px] text-fg-faint">{unit}</span>
      <button type="button" aria-label="increase" onClick={() => set(value + 1)} className={`px-2 py-1 text-xs text-fg-dim transition hover:bg-bg-3 hover:text-fg ${FOCUS}`}>+</button>
    </div>
  )
}

function IconBtn({ label, onClick, disabled, danger, children }: {
  label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1 text-fg-faint transition disabled:opacity-30 ${FOCUS} ${
        danger ? 'hover:bg-warning/15 hover:text-warning' : 'hover:bg-bg-3 hover:text-fg'
      } disabled:hover:bg-transparent disabled:hover:text-fg-faint`}
    >
      {children}
    </button>
  )
}
