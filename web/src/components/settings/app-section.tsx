import {
  adjustMenuBarSpacing, cleanProviderSelection, DESKTOP_GRAPH_RANGES, MENU_BAR_SPACING_MAX_PT,
  patchMenuBarPresentation, resetMenuBarPresentation, setMenuBarElementVisibility, setMenuBarValue,
  toggleProviderSelection,
  type Config, type MenuBarElement, type MenuBarSpacingField, type WebSnapshot,
} from '@shared'
import { Segmented } from '../ui/controls'
import { FOCUS_RING } from '../ui/primitives'
import { FieldRow, NumberStepper, Section } from './primitives'

interface AppSectionProps {
  draft: Config
  patch: (fn: (config: Config) => Config) => void
  snapshot: WebSnapshot | null
}

export function AppSection({ draft, patch, snapshot }: AppSectionProps) {
  const providers = snapshot?.providers ?? []
  const known = new Set(providers.map(provider => provider.id as string))
  const expanded = cleanProviderSelection(draft.desktop.expandedProviders, known)

  const toggleExpanded = (providerId: string) => patch(config => ({
    ...config,
    desktop: {
      ...config.desktop,
      expandedProviders: toggleProviderSelection(config.desktop.expandedProviders, providerId, known),
    },
  }))

  const setMenuBarElement = (element: MenuBarElement) => patch(config => (
    setMenuBarElementVisibility(config, element, !config.tray.menuBar.elements[element])
  ))

  const adjustSpacing = (field: MenuBarSpacingField, direction: -1 | 1) => patch(config => (
    adjustMenuBarSpacing(config, field, direction)
  ))

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

      <Section title="macOS menu bar" right={
        <button
          type="button"
          onClick={() => patch(resetMenuBarPresentation)}
          className={`rounded border border-line px-2 py-1 text-[10px] text-fg-faint transition hover:border-line-2 hover:text-fg ${FOCUS_RING}`}
        >Reset presentation</button>
      }>
        <p className="mb-2.5 text-[11px] text-fg-faint">
          Controls the native menu-bar item. Pin providers from their cards in the desktop overview.
        </p>
        <FieldRow label="Layout" hint="auto tightens spacing on smaller displays">
          <Segmented<'auto' | 'custom'>
            size="xs" ariaLabel="menu bar layout mode"
            options={[{ value: 'auto', label: 'auto' }, { value: 'custom', label: 'custom' }]}
            value={draft.tray.menuBar.mode}
            onChange={mode => patch(config => patchMenuBarPresentation(config, { mode }))}
          />
        </FieldRow>
        <FieldRow label="Elements" hint="choose at least one">
          <div className="flex items-center overflow-hidden rounded border border-line" role="group" aria-label="menu bar elements">
            {([
              ['providerMark', 'provider mark'],
              ['value', 'value'],
              ['progress', 'progress'],
            ] as const).map(([element, label]) => {
              const active = draft.tray.menuBar.elements[element]
              const last = active && Object.values(draft.tray.menuBar.elements).filter(Boolean).length === 1
              return (
                <button
                  key={element} type="button" aria-pressed={active} disabled={last}
                  onClick={() => setMenuBarElement(element)}
                  className={`px-1.5 py-0.5 text-[10px] transition disabled:cursor-not-allowed ${FOCUS_RING} ${
                    active ? 'bg-bg-3 text-accent' : 'text-fg-faint hover:text-fg'
                  }`}
                >{label}</button>
              )
            })}
          </div>
        </FieldRow>
        <FieldRow label="Value" hint="usage percentage or today's local tokens">
          <Segmented<'usage' | 'todayTokens'>
            size="xs" ariaLabel="menu bar value"
            options={[{ value: 'usage', label: 'usage' }, { value: 'todayTokens', label: 'tokens today' }]}
            value={draft.tray.menuBarValue}
            onChange={menuBarValue => patch(config => setMenuBarValue(config, menuBarValue))}
          />
        </FieldRow>
        <FieldRow label="Density" hint="sets the baseline space between providers">
          <Segmented<'comfortable' | 'compact' | 'tight'>
            size="xs" ariaLabel="menu bar density"
            options={[
              { value: 'comfortable', label: 'comfortable' },
              { value: 'compact', label: 'compact' },
              { value: 'tight', label: 'tight' },
            ]}
            value={draft.tray.menuBar.density}
            onChange={density => patch(config => patchMenuBarPresentation(config, { density }))}
          />
        </FieldRow>
        {draft.tray.menuBar.mode === 'custom' ? (
          <div className="mt-1 border-t border-line pt-1">
            <FieldRow label="Edge padding" hint="inside Tokmon's rendered menu-bar item">
              <SpacingStepper label="Edge padding" field="edgePaddingPt" value={draft.tray.menuBar.customSpacing.edgePaddingPt} onAdjust={adjustSpacing} />
            </FieldRow>
            <FieldRow label="Mark to value" hint="space between provider mark and value">
              <SpacingStepper label="Mark to value gap" field="markValueGapPt" value={draft.tray.menuBar.customSpacing.markValueGapPt} onAdjust={adjustSpacing} />
            </FieldRow>
            <FieldRow label="Provider gap" hint="space between pinned providers">
              <SpacingStepper label="Provider gap" field="providerGapPt" value={draft.tray.menuBar.customSpacing.providerGapPt} onAdjust={adjustSpacing} />
            </FieldRow>
          </div>
        ) : null}
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

function SpacingStepper({ label, field, value, onAdjust }: {
  label: string
  field: MenuBarSpacingField
  value: number
  onAdjust: (field: MenuBarSpacingField, direction: -1 | 1) => void
}) {
  return (
    <div className="flex items-center overflow-hidden rounded border border-line">
      <button
        type="button" aria-label={`Decrease ${label}`} disabled={value <= 0}
        onClick={() => onAdjust(field, -1)}
        className={`px-2 py-0.5 text-xs text-fg-dim transition hover:bg-bg-3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 ${FOCUS_RING}`}
      >−</button>
      <output aria-label={`${label} in points`} className="tnum min-w-12 border-x border-line bg-bg-2 px-1.5 py-0.5 text-center text-[10px] text-fg">
        {value.toFixed(1)}pt
      </output>
      <button
        type="button" aria-label={`Increase ${label}`} disabled={value >= MENU_BAR_SPACING_MAX_PT[field]}
        onClick={() => onAdjust(field, 1)}
        className={`px-2 py-0.5 text-xs text-fg-dim transition hover:bg-bg-3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 ${FOCUS_RING}`}
      >+</button>
    </div>
  )
}
