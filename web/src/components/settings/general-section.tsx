import { useEffect, useId, useRef, useState } from 'react'
import { sanitizeTyped, isValidTimezone, normalizeAllowedHost, type Config } from '@shared'
import { Segmented } from '../ui/controls'
import { FOCUS_RING } from '../ui/primitives'
import { Section, FieldRow, NumberStepper } from './primitives'

export function GeneralSection({ draft, patch }: { draft: Config; patch: (fn: (c: Config) => Config) => void }) {
  return (
    <Section title="General">
      <FieldRow label="Refresh interval" hint="dashboard poll, seconds">
        <NumberStepper label="Refresh interval" value={draft.interval} min={1} unit="s" onChange={v => patch(c => ({ ...c, interval: v }))} />
      </FieldRow>
      <FieldRow label="Billing poll" hint="billing refresh, minutes">
        <NumberStepper label="Billing poll" value={draft.billingInterval} min={1} unit="m" onChange={v => patch(c => ({ ...c, billingInterval: v }))} />
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
      <FieldRow label="Network access" hint="applies on daemon restart">
        <Segmented<'local' | 'network'> size="xs" ariaLabel="network access"
          options={[{ value: 'local', label: 'local only' }, { value: 'network', label: 'LAN' }]}
          value={draft.allowNetworkAccess ? 'network' : 'local'}
          onChange={v => patch(c => ({ ...c, allowNetworkAccess: v === 'network' }))} />
      </FieldRow>
      {draft.allowNetworkAccess && (
        <>
          <FieldRow label="Allowed hosts" hint="exact DNS names · comma separated">
            <AllowedHostsField value={draft.allowedHosts} onChange={allowedHosts => patch(c => ({ ...c, allowedHosts }))} />
          </FieldRow>
          <p className="rounded border border-critical/50 bg-critical/10 px-3 py-2 text-xs text-critical" role="alert">
            Unsafe: after the daemon restarts, usage data and settings will be reachable from your local network.
          </p>
        </>
      )}
      <FieldRow label="Reset times" hint="quota and peak changes">
        <Segmented<'relative' | 'absolute'> size="xs" ariaLabel="reset time display"
          options={[{ value: 'relative', label: 'remaining' }, { value: 'absolute', label: 'date/time' }]}
          value={draft.resetDisplay}
          onChange={v => patch(c => ({ ...c, resetDisplay: v }))} />
      </FieldRow>
    </Section>
  )
}

function AllowedHostsField({ value, onChange }: { value: string[]; onChange: (hosts: string[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  const [error, setError] = useState(false)
  const errorId = useId()
  const emittedValue = useRef<string | null>(null)
  const serializedValue = value.join(', ')

  useEffect(() => {
    if (emittedValue.current === serializedValue) {
      emittedValue.current = null
      return
    }
    setText(serializedValue)
    setError(false)
  }, [serializedValue])

  const onInput = (raw: string) => {
    const clean = sanitizeTyped(raw)
    setText(clean)
    const parts = clean.split(',').map(part => part.trim()).filter(Boolean)
    const normalized = parts.map(normalizeAllowedHost)
    const invalid = normalized.some(host => host === null)
    setError(invalid)
    if (!invalid) {
      const hosts = [...new Set(normalized as string[])]
      emittedValue.current = hosts.join(', ')
      onChange(hosts)
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        type="text"
        name="allowed-hosts"
        value={text}
        placeholder="tokmon.example.com"
        aria-label="Allowed hosts"
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error}
        onChange={event => onInput(event.target.value)}
        className={`w-64 rounded border bg-bg-2 px-2 py-1 text-xs text-fg ${FOCUS_RING} ${error ? 'border-critical' : 'border-line'}`}
      />
      {error && <span id={errorId} className="text-[10px] text-critical" role="alert">Use exact hostnames without a scheme, port, path, or wildcard.</span>}
    </div>
  )
}

function TimezoneField({ value, onChange }: { value: string | null; onChange: (tz: string | null) => void }) {
  const [text, setText] = useState(value ?? '')
  const [error, setError] = useState(false)
  const errorId = useId()

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
        name="timezone"
        value={text}
        placeholder="e.g. Europe/Bucharest…"
        aria-label="Timezone"
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error}
        onChange={e => onInput(e.target.value)}
        className={`w-44 rounded border bg-bg-2 px-2 py-1 text-xs text-fg ${FOCUS_RING} ${error ? 'border-critical' : 'border-line'}`}
      />
      {error && <span id={errorId} className="text-[10px] text-critical" role="alert">Use an IANA zone such as Europe/Bucharest.</span>}
    </div>
  )
}
