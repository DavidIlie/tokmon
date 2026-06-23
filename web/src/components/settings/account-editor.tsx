import { useCallback, useEffect, useRef, useState } from 'react'
import {
  sanitizeTyped,
  COLOR_PALETTE, PROVIDER_META, PROVIDER_ORDER,
  type Account,
} from '@shared'
import { listDir, type FsListing } from '../../lib/config-client'
import { namedColorHex } from '../../lib/colors'
import {
  displayFolderPath, normalizeBrowseStartPath, rowsForListing,
  type FolderPickerRow,
} from '../../lib/folder-picker.logic'
import { Check, ChevronUp, ChevronDown, Folder, X } from '../icons'
import { FOCUS, useDialogTrap } from './use-dialog-trap'
import { type AccountDraft, previewAccountId, buildAccountFromDraft } from './account-editor.logic'
import { Field } from './primitives'

export function AccountEditor({ editor, accounts, onChange, onCancel, onSubmit }: {
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

  const previewId = previewAccountId(editor, accounts)

  const submit = () => {
    const result = buildAccountFromDraft(editor, accounts)
    if (!result.ok) { setError(result.error); return }
    onSubmit(result.account, result.mode, result.editingId)
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
