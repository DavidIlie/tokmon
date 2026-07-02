import { PROVIDER_META, PROVIDER_ORDER, type Config, type ProviderId } from '@shared'
import { namedColorHex } from '../../lib/colors'
import { Check } from '../icons'
import { FOCUS } from './use-dialog-trap'
import { Section } from './primitives'

export function ProvidersSection({ draft, patch }: { draft: Config; patch: (fn: (c: Config) => Config) => void }) {
  const toggle = (pid: ProviderId, enabled: boolean) =>
    patch(c => ({
      ...c,
      knownProviders: c.knownProviders.includes(pid) ? c.knownProviders : [...c.knownProviders, pid],
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
