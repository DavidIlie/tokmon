import { useEffect, useState } from 'react'
import { sanitizeTyped, isValidTimezone, type Config } from '@shared'
import { Segmented } from '../ui/controls'
import { FOCUS } from './use-dialog-trap'
import { Section, FieldRow, NumberStepper } from './primitives'

export function GeneralSection({ draft, patch }: { draft: Config; patch: (fn: (c: Config) => Config) => void }) {
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
