import { providerDetectionEnabled, PROVIDER_META, PROVIDER_ORDER, setProviderDetectionEnabled, setProviderTrackingEnabled, type Config, type ProviderId, type WebSnapshot } from '@shared'
import { namedColorHex } from '../../lib/colors'
import { Check } from '../icons'
import { FOCUS_RING } from '../ui/primitives'
import { Section } from './primitives'

export function ProvidersSection({ draft, patch, snapshot }: {
  draft: Config
  patch: (fn: (c: Config) => Config) => void
  snapshot: WebSnapshot | null
}) {
  const toggle = (pid: ProviderId, enabled: boolean) =>
    patch(c => setProviderTrackingEnabled(c, pid, enabled))
  return (
    <Section title="Providers" right={
      <button
        type="button" role="switch" aria-checked={draft.accountDetection.enabled}
        onClick={() => patch(c => ({ ...c, accountDetection: { ...c.accountDetection, enabled: !c.accountDetection.enabled } }))}
        className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wide transition ${FOCUS_RING} ${
          draft.accountDetection.enabled ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-fg-faint'
        }`}
      >Auto-detect {draft.accountDetection.enabled ? 'on' : 'off'}</button>
    }>
      <p className="mb-2.5 text-[11px] text-fg-faint">
        Tracking controls a whole harness. Auto-detect controls every detected account; remove individual accounts from the Accounts section.
      </p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {PROVIDER_ORDER.map(pid => {
          const enabled = !draft.disabledProviders.includes(pid)
          const detectorEnabled = providerDetectionEnabled(draft.accountDetection, pid)
          const meta = PROVIDER_META[pid]
          const installed = snapshot?.installedProviders?.includes(pid) ?? false
          return (
            <div
              key={pid}
              className={`flex items-center gap-2 rounded border px-2.5 py-2 text-left text-xs transition ${
                enabled ? 'border-line-2 bg-bg-2 text-fg' : 'border-line bg-bg-1 text-fg-faint hover:border-line-2'
              }`}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: namedColorHex(meta.color) }} aria-hidden />
              <span className={`font-medium ${enabled ? 'text-fg' : 'text-fg-faint'}`}>
                {meta.name}{installed ? ' · installed' : ''}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button" role="switch" aria-checked={enabled}
                  aria-label={`${enabled ? 'Stop' : 'Start'} tracking ${meta.name}`}
                  onClick={() => toggle(pid, !enabled)}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] ${FOCUS_RING} ${enabled ? 'border-line-2 text-fg' : 'border-line text-fg-faint'}`}
                >
                  {enabled && <Check className="size-3" />} Track
                </button>
                <button
                  type="button" role="switch" aria-checked={detectorEnabled}
                  disabled={!draft.accountDetection.enabled}
                  aria-label={`${detectorEnabled ? 'Disable' : 'Enable'} ${meta.name} account discovery`}
                  onClick={() => patch(c => ({
                    ...c,
                    accountDetection: setProviderDetectionEnabled(c.accountDetection, pid, !detectorEnabled),
                  }))}
                  className={`rounded border px-1.5 py-1 text-[10px] disabled:opacity-40 ${FOCUS_RING} ${detectorEnabled ? 'border-accent/50 text-accent' : 'border-line text-fg-faint'}`}
                >Auto</button>
              </span>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
