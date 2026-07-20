import { useMemo, useState } from 'react'
import {
  BUILT_IN_THEME_PRESET_IDS,
  isBuiltInThemePreset,
  isDarkOnlyThemePreset,
  normalizeHexColor,
  resolveTheme,
  THEME_PRESET_OPTIONS,
  themePresetOption,
  type AppearanceConfig,
  type Config,
  type EditableThemeTokens,
  type ThemePreset,
} from '@shared'
import { Segmented } from '../ui/controls'
import { FieldRow, Section } from './primitives'
import { FOCUS_RING } from '../ui/primitives'
import { validateAppearanceDraft } from '../../lib/theme-runtime'

type GraphicalMode = 'light' | 'dark'
type EditableKey = keyof EditableThemeTokens

const COLOR_GROUPS: ReadonlyArray<{ label: string; keys: ReadonlyArray<{ key: EditableKey; label: string }> }> = [
  { label: 'surfaces', keys: [
    { key: 'canvas', label: 'Canvas' }, { key: 'panel', label: 'Panel' },
    { key: 'inset', label: 'Inset' }, { key: 'insetStrong', label: 'Raised inset' },
    { key: 'chrome', label: 'Desktop chrome' }, { key: 'line', label: 'Line' },
    { key: 'lineStrong', label: 'Strong line' }, { key: 'lineFaint', label: 'Faint line' },
  ] },
  { label: 'type', keys: [
    { key: 'text', label: 'Text' }, { key: 'textDim', label: 'Dim text' },
    { key: 'textFaint', label: 'Faint text' }, { key: 'textStrong', label: 'Strong text' },
  ] },
  { label: 'signals', keys: [
    { key: 'accent', label: 'Accent' }, { key: 'cost', label: 'Cost' },
    { key: 'positive', label: 'Savings' },
  ] },
]

const MODE_OPTIONS = [
  { value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
] as const
const TERMINAL_OPTIONS = [
  { value: 'ansi', label: 'Terminal' }, { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }, { value: 'off', label: 'Off' },
] as const

function customOf(appearance: AppearanceConfig) {
  return appearance.custom ?? { base: 'tokmon' as const, light: {}, dark: {} }
}

function patchAppearance(draft: Config, patch: Partial<AppearanceConfig>): Config {
  return { ...draft, appearance: { ...draft.appearance, ...patch } }
}

function PresetPreview({ preset, selected, appearance, onSelect }: {
  preset: ThemePreset
  selected: boolean
  appearance: AppearanceConfig
  onSelect(): void
}) {
  const previewAppearance: AppearanceConfig = preset === 'custom'
    ? { ...appearance, preset, custom: customOf(appearance), mode: 'dark' }
    : { ...appearance, preset, mode: 'dark' }
  const tokens = resolveTheme(previewAppearance, 'dark').tokens
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`min-w-0 rounded border p-2 text-left transition ${FOCUS_RING} ${selected ? 'border-accent' : 'border-line hover:border-line-2'}`}
      style={{ background: tokens.panel, color: tokens.text }}
    >
      <span className="mb-2 flex items-center gap-1.5 text-[11px] font-medium">
        <span className="size-2 rounded-full" style={{ background: tokens.accent }} aria-hidden />
        <span className="truncate">{themePresetOption(preset).name}</span>
      </span>
      <span className="flex h-5 items-end gap-1" aria-hidden>
        {[tokens.textFaint, tokens.textDim, tokens.cost, tokens.accent].map((color, index) => (
          <span key={color} className="flex-1 rounded-sm" style={{ height: `${7 + index * 3}px`, background: color }} />
        ))}
      </span>
    </button>
  )
}

export function ThemeSection({ draft, patch }: {
  draft: Config
  patch: (fn: (config: Config) => Config) => void
}) {
  const appearance = draft.appearance
  const [customMode, setCustomMode] = useState<GraphicalMode>('dark')
  const custom = customOf(appearance)
  const resolved = useMemo(() => resolveTheme({ ...appearance, preset: 'custom', custom, mode: customMode }, customMode), [appearance, custom, customMode])
  const issues = useMemo(() => validateAppearanceDraft(appearance), [appearance])
  const currentIssues = issues.filter(issue => issue.mode === customMode)
  const failureKeys = new Set(currentIssues.flatMap(issue => issue.keys))
  const valid = issues.length === 0

  const selectPreset = (preset: ThemePreset) => patch(config => patchAppearance(config, {
    preset,
    ...(preset === 'custom' ? { custom: customOf(config.appearance) } : {}),
    ...(isDarkOnlyThemePreset(preset) ? { mode: 'dark' } : {}),
  }))

  const customizePreset = (base = appearance.preset) => {
    if (!isBuiltInThemePreset(base)) return
    patch(config => patchAppearance(config, {
      preset: 'custom',
      custom: { base, light: {}, dark: {} },
    }))
  }

  const updateCustom = (fn: (value: typeof custom) => typeof custom) => patch(config => patchAppearance(config, {
    preset: 'custom',
    custom: fn(customOf(config.appearance)),
  }))

  return (
    <div className="space-y-6">
      <Section title="appearance">
        <FieldRow label="Mode" hint="Auto follows the operating system live.">
          <Segmented
            options={isDarkOnlyThemePreset(appearance.preset) ? [{ value: 'dark' as const, label: 'Dark' }] : [...MODE_OPTIONS]}
            value={isDarkOnlyThemePreset(appearance.preset) ? 'dark' : appearance.mode}
            onChange={mode => patch(config => patchAppearance(config, { mode }))}
            ariaLabel="graphical color mode"
          />
        </FieldRow>
        <FieldRow label="Terminal colors" hint="Keep ANSI to preserve the classic Tokmon CLI.">
          <Segmented
            options={[...TERMINAL_OPTIONS]}
            value={appearance.terminal}
            onChange={terminal => patch(config => patchAppearance(config, { terminal }))}
            ariaLabel="terminal theme policy"
            size="xs"
          />
        </FieldRow>
      </Section>

      <Section title="preset">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {THEME_PRESET_OPTIONS.map(option => (
            <PresetPreview key={option.id} preset={option.id} selected={appearance.preset === option.id} appearance={appearance} onSelect={() => selectPreset(option.id)} />
          ))}
        </div>
        <div className="mt-3 flex min-h-7 items-center justify-between gap-3">
          <p className="text-[11px] text-fg-faint">
            {isDarkOnlyThemePreset(appearance.preset)
              ? 'Phosphor is intentionally dark-only.'
              : themePresetOption(appearance.preset).hint}
          </p>
          {isBuiltInThemePreset(appearance.preset) && (
            <button
              type="button"
              onClick={() => customizePreset()}
              className={`shrink-0 rounded border border-line px-2.5 py-1 text-[11px] text-fg-dim transition hover:border-line-2 hover:text-fg ${FOCUS_RING}`}
            >
              customize {themePresetOption(appearance.preset).name}
            </button>
          )}
        </div>
      </Section>

      {appearance.preset === 'custom' && (
        <Section
          title="custom palette"
          right={<Segmented options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} value={customMode} onChange={setCustomMode} size="xs" ariaLabel="custom palette variant" />}
        >
          <FieldRow label="Starting point" hint="Changing the base resets both variants.">
            <select
              value={custom.base}
              onChange={event => {
                const base = event.target.value
                if (isBuiltInThemePreset(base)) updateCustom(() => ({ base, light: {}, dark: {} }))
              }}
              aria-label="custom theme base"
              className={`min-h-8 rounded border border-line bg-bg-2 px-2 text-xs text-fg ${FOCUS_RING}`}
            >
              {BUILT_IN_THEME_PRESET_IDS.map(base => <option key={base} value={base}>{themePresetOption(base).name}</option>)}
            </select>
          </FieldRow>

          <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {COLOR_GROUPS.flatMap(group => group.keys.map(item => ({ ...item, group: group.label }))).map(({ key, label, group }) => {
              const value = custom[customMode][key] ?? resolved.tokens[key]
              const invalid = failureKeys.has(key)
              return (
                <label key={key} className="min-w-0">
                  <span className="mb-1 flex items-baseline justify-between gap-2 text-xs text-fg">
                    {label}<span className="text-[9px] uppercase tracking-wider text-fg-faint">{group}</span>
                  </span>
                  <span className={`flex items-center gap-2 rounded border bg-bg-2 p-1 ${invalid ? 'border-critical' : 'border-line'}`}>
                    <input
                      type="color"
                      aria-label={`${customMode} ${label} color`}
                      value={normalizeHexColor(value) ?? resolved.tokens[key]}
                      onChange={event => updateCustom(current => ({
                        ...current,
                        [customMode]: { ...current[customMode], [key]: event.target.value },
                      }))}
                      className="size-7 cursor-pointer border-0 bg-transparent p-0"
                    />
                    <input
                      type="text"
                      spellCheck={false}
                      maxLength={7}
                      pattern="#[0-9A-Fa-f]{6}"
                      value={value}
                      aria-invalid={invalid}
                      onChange={event => updateCustom(current => ({
                        ...current,
                        [customMode]: { ...current[customMode], [key]: event.target.value },
                      }))}
                      className={`tnum min-w-0 flex-1 bg-transparent px-1 text-xs text-fg outline-none ${FOCUS_RING}`}
                    />
                  </span>
                  {invalid && <span className="mt-1 block text-[10px] text-critical">Use #RRGGBB with readable contrast.</span>}
                </label>
              )
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className={`text-[11px] ${valid ? 'text-positive' : 'text-critical'}`} role="status">
              {valid ? 'Light and dark palettes pass contrast checks' : `${issues.length} palette issue${issues.length === 1 ? '' : 's'}`}
            </span>
            <button
              type="button"
              onClick={() => updateCustom(current => ({ ...current, [customMode]: {} }))}
              className={`rounded border border-line px-2.5 py-1 text-[11px] text-fg-dim transition hover:border-line-2 hover:text-fg ${FOCUS_RING}`}
            >
              reset {customMode}
            </button>
          </div>
        </Section>
      )}
    </div>
  )
}
