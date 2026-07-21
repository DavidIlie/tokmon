import { DESKTOP_GRAPH_RANGES, type Config, type WebSnapshot } from '@shared'
import { Check, ChevronDown, ChevronUp } from '../icons'
import { Segmented } from '../ui/controls'
import { FOCUS_RING } from '../ui/primitives'
import { FieldRow, IconBtn, NumberStepper, Section } from './primitives'
import {
  cleanProviderSelection,
  MAX_PINNED_PROVIDERS,
  moveProviderSelection,
  toggleProviderSelection,
} from './app-section.logic'

interface AppSectionProps {
  draft: Config
  patch: (fn: (config: Config) => Config) => void
  snapshot: WebSnapshot | null
}

export function AppSection({ draft, patch, snapshot }: AppSectionProps) {
  const providers = snapshot?.providers ?? []
  const known = new Set(providers.map(provider => provider.id as string))
  const pinned = cleanProviderSelection(draft.tray.pinnedProviders, known, MAX_PINNED_PROVIDERS)
  const expanded = cleanProviderSelection(draft.desktop.expandedProviders, known)

  const setPins = (next: string[]) => patch(config => ({
    ...config,
    tray: {
      ...config.tray,
      pinnedProviders: next,
      pins: [],
      pinnedAccount: null,
    },
  }))

  const toggleExpanded = (providerId: string) => patch(config => ({
    ...config,
    desktop: {
      ...config.desktop,
      expandedProviders: toggleProviderSelection(config.desktop.expandedProviders, providerId, known),
    },
  }))

  return (
    <>
      <Section title="App">
        <FieldRow label="Privacy mode" hint={`global identity masking · ${draft.privacyToggleKey.toUpperCase()} shortcut`}>
          <Segmented<'on' | 'off'>
            size="xs" ariaLabel="privacy mode"
            options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]}
            value={draft.privacyMode ? 'on' : 'off'}
            onChange={value => patch(config => ({ ...config, privacyMode: value === 'on' }))}
          />
        </FieldRow>
        <FieldRow label="Provider summary" hint="smart pools account capacity · tightest shows the highest single usage">
          <Segmented<'smartHeadroom' | 'tightestRemaining'>
            size="xs" ariaLabel="menu bar value"
            options={[{ value: 'smartHeadroom', label: 'smart' }, { value: 'tightestRemaining', label: 'tightest' }]}
            value={draft.tray.displayMetric}
            onChange={displayMetric => patch(config => ({ ...config, tray: { ...config.tray, displayMetric } }))}
          />
        </FieldRow>
        <FieldRow label="Menu bar value" hint="show usage percentage or today's local token total">
          <Segmented<'usage' | 'todayTokens'>
            size="xs" ariaLabel="menu bar value"
            options={[{ value: 'usage', label: 'usage' }, { value: 'todayTokens', label: 'tokens today' }]}
            value={draft.tray.menuBarValue}
            onChange={menuBarValue => patch(config => ({ ...config, tray: { ...config.tray, menuBarValue } }))}
          />
        </FieldRow>
        <FieldRow label="Show value in menu bar" hint="hide the number and keep the provider mark">
          <Segmented<'on' | 'off'>
            size="xs" ariaLabel="show menu bar value"
            options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]}
            value={draft.tray.showMenuBarText ? 'on' : 'off'}
            onChange={value => patch(config => ({ ...config, tray: { ...config.tray, showMenuBarText: value === 'on' } }))}
          />
        </FieldRow>
        <FieldRow label="Active window" hint="recent activity used by smart headroom">
          <NumberStepper
            label="Active window" value={draft.tray.activeTimeoutMin} min={1} unit="min"
            onChange={activeTimeoutMin => patch(config => ({
              ...config,
              tray: { ...config.tray, activeTimeoutMin: Math.min(1_440, activeTimeoutMin) },
            }))}
          />
        </FieldRow>
        <FieldRow label="Graph range" hint="trailing spend activity in the desktop popover">
          <Segmented<'7' | '14' | '30'>
            size="xs" ariaLabel="desktop graph range"
            options={DESKTOP_GRAPH_RANGES.map(value => ({ value: String(value) as '7' | '14' | '30', label: `${value}d` }))}
            value={String(draft.desktop.graphRangeDays) as '7' | '14' | '30'}
            onChange={value => patch(config => ({
              ...config,
              desktop: { ...config.desktop, graphRangeDays: Number(value) as 7 | 14 | 30 },
            }))}
          />
        </FieldRow>
        <FieldRow label="Launch at login" hint="start the desktop menu bar app automatically">
          <Segmented<'on' | 'off'>
            size="xs" ariaLabel="launch desktop app at login"
            options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]}
            value={draft.tray.launchAtLogin ? 'on' : 'off'}
            onChange={value => patch(config => ({ ...config, tray: { ...config.tray, launchAtLogin: value === 'on' } }))}
          />
        </FieldRow>
      </Section>

      <Section title="Menu bar providers" right={<span className="text-[10px] text-fg-faint">{pinned.length}/{MAX_PINNED_PROVIDERS} pinned</span>}>
        {providers.length === 0 ? (
          <p className="rounded border border-line bg-bg-2/50 px-3 py-3 text-xs text-fg-faint">Waiting for provider data…</p>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {providers.map(provider => {
              const index = pinned.indexOf(provider.id)
              const selected = index >= 0
              const full = !selected && pinned.length >= MAX_PINNED_PROVIDERS
              return (
                <div key={provider.id} className={`flex items-center gap-2 rounded border px-2.5 py-2 ${selected ? 'border-line-2 bg-bg-2' : 'border-line bg-bg-1'}`}>
                  <button
                    type="button" role="checkbox" aria-checked={selected} disabled={full}
                    aria-label={`${selected ? 'Unpin' : 'Pin'} ${provider.name}`}
                    onClick={() => setPins(toggleProviderSelection(pinned, provider.id, known, MAX_PINNED_PROVIDERS))}
                    className={`inline-flex size-5 shrink-0 items-center justify-center rounded border text-[10px] transition disabled:cursor-not-allowed disabled:opacity-35 ${FOCUS_RING}`}
                    style={{ borderColor: selected ? provider.color : 'var(--color-line-2)', color: provider.color }}
                  >
                    {selected ? index + 1 : <Check className="size-3 opacity-0" />}
                  </button>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: provider.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-xs text-fg">{provider.name}</span>
                  {selected && (
                    <span className="flex shrink-0 items-center">
                      <IconBtn label={`Move ${provider.name} left`} disabled={index === 0} onClick={() => setPins(moveProviderSelection(pinned, provider.id, -1))}><ChevronUp className="size-3.5 -rotate-90" /></IconBtn>
                      <IconBtn label={`Move ${provider.name} right`} disabled={index === pinned.length - 1} onClick={() => setPins(moveProviderSelection(pinned, provider.id, 1))}><ChevronDown className="size-3.5 -rotate-90" /></IconBtn>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-fg-faint">The numbered order matches the menu bar from left to right.</p>
      </Section>

      <Section title="Popover defaults">
        <p className="mb-2 text-[11px] text-fg-faint">Choose which provider cards start expanded. You can still open or close any card in the app.</p>
        <div className="flex flex-wrap gap-1.5">
          {providers.map(provider => {
            const selected = expanded.includes(provider.id)
            return (
              <button
                key={provider.id} type="button" aria-pressed={selected}
                onClick={() => toggleExpanded(provider.id)}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition ${FOCUS_RING} ${selected ? 'border-line-2 bg-bg-2 text-fg' : 'border-line bg-bg-1 text-fg-faint hover:text-fg'}`}
              >
                <span style={{ color: provider.color }} aria-hidden>{selected ? '●' : '○'}</span>
                {provider.name}
              </button>
            )
          })}
        </div>
      </Section>
    </>
  )
}
