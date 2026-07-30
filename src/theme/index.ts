// Node-free theme engine shared by the TUI, web renderer, and desktop renderer.

import {
  IMPORTED_THEME_CATALOG,
  IMPORTED_THEME_IDS,
  type CatalogThemeColors,
  type ImportedThemeId,
} from './catalog'

export { IMPORTED_THEME_CATALOG, IMPORTED_THEME_IDS } from './catalog'
export type { CatalogTheme, CatalogThemeColors, ImportedThemeId } from './catalog'

export type ThemeMode = 'auto' | 'light' | 'dark'
export type AppearanceMode = ThemeMode
export type ResolvedThemeMode = Exclude<ThemeMode, 'auto'>
export const BUILT_IN_THEME_PRESET_IDS = ['tokmon', 'phosphor', ...IMPORTED_THEME_IDS] as const
export const THEME_PRESET_IDS = [...BUILT_IN_THEME_PRESET_IDS, 'custom'] as const

export type BuiltInThemePreset = typeof BUILT_IN_THEME_PRESET_IDS[number]
export type ThemePreset = typeof THEME_PRESET_IDS[number]
export type TerminalThemePolicy = 'ansi' | 'dark' | 'light' | 'off'

export interface ThemePresetOption {
  id: ThemePreset
  name: string
  hint: string
  darkOnly: boolean
  custom: boolean
}

const IMPORTED_THEME_HINTS: Record<ImportedThemeId, string> = {
  vscode: 'VS Code Light+ and Dark+',
  monokai: 'Classic editor green and cyan',
  dracula: 'Purple and pink on deep slate',
  github: 'GitHub light and dark',
  nord: 'Arctic blue-gray palette',
  'one-dark-pro': 'Atom-inspired editor palette',
  solarized: 'Precision blue and teal',
  'tokyo-night': 'Cool blue and violet',
  catppuccin: 'Latte and Mocha palettes',
  midnight: 'Deep navy and bright blue',
  forest: 'Natural green surfaces',
  sunset: 'Warm orange and earth tones',
  cyberpunk: 'Neon cyan, pink, and yellow',
  synthwave: 'Purple and electric cyan',
  luxury: 'Gold on warm neutrals',
  minimal: 'High-contrast monochrome',
}

export const THEME_PRESET_OPTIONS: readonly ThemePresetOption[] = [
  { id: 'tokmon', name: 'Tokmon', hint: 'Calm system utility', darkOnly: false, custom: false },
  { id: 'phosphor', name: 'Phosphor', hint: 'Black terminal green', darkOnly: true, custom: false },
  ...IMPORTED_THEME_IDS.map(id => ({
    id,
    name: IMPORTED_THEME_CATALOG[id].name,
    hint: IMPORTED_THEME_HINTS[id],
    darkOnly: false,
    custom: false,
  } as const)),
  { id: 'custom', name: 'Custom', hint: 'Your shared palette', darkOnly: false, custom: true },
]

export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && (THEME_PRESET_IDS as readonly string[]).includes(value)
}

export function isBuiltInThemePreset(value: unknown): value is BuiltInThemePreset {
  return typeof value === 'string' && (BUILT_IN_THEME_PRESET_IDS as readonly string[]).includes(value)
}

export function themePresetOption(preset: ThemePreset): ThemePresetOption {
  return THEME_PRESET_OPTIONS.find(option => option.id === preset) ?? THEME_PRESET_OPTIONS[0]!
}

export function isDarkOnlyThemePreset(preset: ThemePreset): boolean {
  return themePresetOption(preset).darkOnly
}

export const EDITABLE_THEME_TOKEN_KEYS = [
  'canvas', 'panel', 'inset', 'insetStrong', 'chrome',
  'line', 'lineStrong', 'lineFaint',
  'text', 'textDim', 'textFaint', 'textStrong',
  'accent', 'cost', 'positive',
] as const

export type EditableThemeToken = typeof EDITABLE_THEME_TOKEN_KEYS[number]
export type EditableThemeTokens = Record<EditableThemeToken, string>
export type ThemeOverrides = Partial<EditableThemeTokens>

export interface CustomThemeConfig {
  base: BuiltInThemePreset
  light: ThemeOverrides
  dark: ThemeOverrides
}

export interface AppearanceConfig {
  version: 1
  mode: ThemeMode
  preset: ThemePreset
  terminal: TerminalThemePolicy
  custom?: CustomThemeConfig
}

export interface ThemeTokens extends EditableThemeTokens {
  /** Locked truth colors: custom themes cannot redefine them. */
  ok: string
  warn: string
  crit: string
  unknown: string
}

export interface ResolvedThemeTokens extends ThemeTokens {
  card: string
  cardHover: string
  divider: string
  track: string
  accentTint: string
  accentOn: string
  focusRing: string
}

export interface ResolvedTheme {
  mode: ResolvedThemeMode
  tokens: ResolvedThemeTokens
}

export interface AppearanceRepair {
  appearance: AppearanceConfig
  repaired: boolean
  reasons: string[]
}

export interface ContrastFailure {
  foreground: keyof ThemeTokens
  background: keyof ThemeTokens
  minimum: number
  actual: number
}

export const DEFAULT_APPEARANCE: AppearanceConfig = Object.freeze({
  version: 1,
  mode: 'auto',
  preset: 'tokmon',
  terminal: 'ansi',
})

// The Tokmon values deliberately mirror the pre-theme web palette. `chrome`
// retains the native popover's existing window color.
const TOKMON_DARK: ThemeTokens = {
  canvas: '#0a0a0a', panel: '#101011', inset: '#161617', insetStrong: '#1d1d1e', chrome: '#1e1f22',
  line: '#262627', lineStrong: '#343435', lineFaint: '#1a1a1b',
  text: '#d4d6d6', textDim: '#8d9090', textFaint: '#585b5b', textStrong: '#f3f5f5',
  accent: '#79be7e', cost: '#d9c074', positive: '#6caa71',
  ok: '#79be7e', warn: '#e0b84c', crit: '#e5584b', unknown: '#8d9090',
}

const TOKMON_LIGHT: ThemeTokens = {
  canvas: '#f4f5f5', panel: '#ffffff', inset: '#eceeee', insetStrong: '#e1e4e4', chrome: '#f4f5f5',
  line: '#d4d9d9', lineStrong: '#bcc2c2', lineFaint: '#e7eaea',
  text: '#2b2e2e', textDim: '#5a6060', textFaint: '#979d9d', textStrong: '#0d1010',
  accent: '#2f8f57', cost: '#9a7b1c', positive: '#2f8f57',
  ok: '#2f8f57', warn: '#9a7b1c', crit: '#b0403a', unknown: '#5a6060',
}

const PHOSPHOR_DARK: ThemeTokens = {
  canvas: '#000000', panel: '#050705', inset: '#0a0f0b', insetStrong: '#101710', chrome: '#070b08',
  line: '#1a2a1e', lineStrong: '#2c4634', lineFaint: '#101812',
  text: '#c6f7d3', textDim: '#7fc98d', textFaint: '#4c7d57', textStrong: '#eafff0',
  accent: '#35f38a', cost: '#ffd24a', positive: '#35f38a',
  ok: '#35f38a', warn: '#ffc44d', crit: '#ff6b5b', unknown: '#7fc98d',
}

// Only custom themes can use the phosphor language in light mode. The direct
// phosphor preset resolves dark because a black canvas is part of its identity.
const PHOSPHOR_LIGHT: ThemeTokens = {
  canvas: '#f3f5f0', panel: '#ffffff', inset: '#e8ede7', insetStrong: '#dce5dc', chrome: '#f3f5f0',
  line: '#cad7ca', lineStrong: '#a9bca9', lineFaint: '#e4ebe4',
  text: '#0b2610', textDim: '#426b49', textFaint: '#748c78', textStrong: '#031507',
  accent: '#128a2e', cost: '#826500', positive: '#128a2e',
  ok: '#128a2e', warn: '#826500', crit: '#b23a32', unknown: '#5c705f',
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Accept only CSS #RRGGBB colors and canonicalise them to lowercase. */
export function normalizeHexColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : null
}

function channels(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)]
}

function hexChannel(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
}

export function mixColors(from: string, to: string, amount: number): string {
  const [fr, fg, fb] = channels(from)
  const [tr, tg, tb] = channels(to)
  const ratio = Math.max(0, Math.min(1, amount))
  return `#${hexChannel(fr + (tr - fr) * ratio)}${hexChannel(fg + (tg - fg) * ratio)}${hexChannel(fb + (tb - fb) * ratio)}`
}

export function relativeLuminance(hex: string): number {
  const normalized = normalizeHexColor(hex)
  if (!normalized) throw new TypeError('expected a #RRGGBB color')
  const linear = channels(normalized).map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export function accessibleColor(color: string, backgrounds: readonly string[], minimum: number, toward: string): string {
  const intended = normalizeHexColor(color)!
  if (backgrounds.every(background => contrastRatio(intended, background) >= minimum)) return intended

  const target = [toward, '#000000', '#ffffff'].reduce((best, candidate) => (
    Math.min(...backgrounds.map(background => contrastRatio(candidate, background)))
      > Math.min(...backgrounds.map(background => contrastRatio(best, background)))
      ? candidate
      : best
  ))

  let low = 0
  let high = 1
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2
    const candidate = mixColors(intended, target, mid)
    if (backgrounds.every(background => contrastRatio(candidate, background) >= minimum)) high = mid
    else low = mid
  }
  return mixColors(intended, target, high)
}

function importedTokens(colors: CatalogThemeColors, mode: ResolvedThemeMode): ThemeTokens {
  const canvas = normalizeHexColor(colors.background)!
  const panel = normalizeHexColor(colors.card)!
  const rawText = normalizeHexColor(colors.foreground)!
  const contrastTarget = mode === 'dark' ? '#ffffff' : '#000000'
  const text = accessibleColor(rawText, [canvas, panel], 4.5, contrastTarget)
  const textStrong = accessibleColor(colors.cardForeground, [canvas, panel], 4.5, contrastTarget)
  const textDim = accessibleColor(colors.mutedForeground, [canvas], 3, text)
  const accent = accessibleColor(colors.primary, [canvas, panel], 3, text)
  const cost = accessibleColor(colors.accent, [panel], 3, text)
  const positive = accessibleColor(colors.primary, [panel], 3, text)
  const truth = mode === 'dark' ? TOKMON_DARK : TOKMON_LIGHT

  return {
    canvas,
    panel,
    inset: normalizeHexColor(colors.muted)!,
    insetStrong: mixColors(colors.muted, colors.foreground, 0.08),
    chrome: canvas,
    line: normalizeHexColor(colors.border)!,
    lineStrong: mixColors(colors.border, colors.foreground, 0.18),
    lineFaint: mixColors(colors.background, colors.border, 0.5),
    text,
    textDim,
    textFaint: normalizeHexColor(colors.mutedForeground)!,
    textStrong,
    accent,
    cost,
    positive,
    ok: accessibleColor(truth.ok, [panel], 3, text),
    warn: accessibleColor(truth.warn, [panel], 3, text),
    crit: accessibleColor(truth.crit, [panel], 3, text),
    unknown: textDim,
  }
}

const IMPORTED_PRESETS = Object.fromEntries(IMPORTED_THEME_IDS.map(id => [
  id,
  {
    light: importedTokens(IMPORTED_THEME_CATALOG[id].light, 'light'),
    dark: importedTokens(IMPORTED_THEME_CATALOG[id].dark, 'dark'),
  },
])) as Record<ImportedThemeId, { light: ThemeTokens; dark: ThemeTokens }>

const PRESETS: Record<BuiltInThemePreset, { light: ThemeTokens; dark: ThemeTokens }> = {
  tokmon: { light: TOKMON_LIGHT, dark: TOKMON_DARK },
  phosphor: { light: PHOSPHOR_LIGHT, dark: PHOSPHOR_DARK },
  ...IMPORTED_PRESETS,
}

const CONTRAST_RULES: readonly [keyof ThemeTokens, keyof ThemeTokens, number][] = [
  ['text', 'canvas', 4.5],
  ['text', 'panel', 4.5],
  ['textStrong', 'canvas', 4.5],
  ['textStrong', 'panel', 4.5],
  ['textDim', 'canvas', 3],
  ['accent', 'canvas', 3],
  ['accent', 'panel', 3],
  ['cost', 'panel', 3],
  ['positive', 'panel', 3],
  ['ok', 'panel', 3],
  ['warn', 'panel', 3],
  ['crit', 'panel', 3],
]

export function validateThemeContrast(tokens: ThemeTokens): ContrastFailure[] {
  return CONTRAST_RULES.flatMap(([foreground, background, minimum]) => {
    const actual = contrastRatio(tokens[foreground], tokens[background])
    return actual + Number.EPSILON < minimum ? [{ foreground, background, minimum, actual }] : []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanOverrides(value: unknown, mode: ResolvedThemeMode, base: ThemeTokens, reasons: string[]): ThemeOverrides {
  if (!isRecord(value)) {
    if (value !== undefined) reasons.push(`custom.${mode} was not an object`)
    return {}
  }

  const overrides: ThemeOverrides = {}
  for (const key of EDITABLE_THEME_TOKEN_KEYS) {
    if (!(key in value)) continue
    const color = normalizeHexColor(value[key])
    if (color) overrides[key] = color
    else reasons.push(`custom.${mode}.${key} was not a #RRGGBB color`)
  }

  // Validate the whole candidate first so coordinated foreground/background
  // overrides remain intact. On failure, discard the editable override that
  // introduced it (foreground first, then background), never a locked color.
  for (;;) {
    const candidate = { ...base, ...overrides }
    const failure = validateThemeContrast(candidate)[0]
    if (!failure) break
    const foreground = failure.foreground as EditableThemeToken
    const background = failure.background as EditableThemeToken
    if (foreground in overrides) {
      delete overrides[foreground]
      reasons.push(`custom.${mode}.${foreground} did not meet WCAG contrast`)
    } else if (background in overrides) {
      delete overrides[background]
      reasons.push(`custom.${mode}.${background} did not meet WCAG contrast`)
    } else {
      // All built-in palettes pass; this protects against a future bad preset
      // without risking an infinite repair loop.
      break
    }
  }
  return overrides
}

export function repairAppearance(input: unknown): AppearanceRepair {
  const reasons: string[] = []
  const raw = isRecord(input) ? input : {}
  if (raw !== input && input !== undefined) reasons.push('appearance was not an object')

  const mode: ThemeMode = raw.mode === 'light' || raw.mode === 'dark' || raw.mode === 'auto' ? raw.mode : DEFAULT_APPEARANCE.mode
  if (raw.mode !== undefined && raw.mode !== mode) reasons.push('appearance.mode was invalid')
  const preset: ThemePreset = isThemePreset(raw.preset) ? raw.preset : DEFAULT_APPEARANCE.preset
  if (raw.preset !== undefined && raw.preset !== preset) reasons.push('appearance.preset was invalid')
  const terminal: TerminalThemePolicy = raw.terminal === 'dark' || raw.terminal === 'light' || raw.terminal === 'off' || raw.terminal === 'ansi'
    ? raw.terminal
    : DEFAULT_APPEARANCE.terminal
  if (raw.terminal !== undefined && raw.terminal !== terminal) reasons.push('appearance.terminal was invalid')
  if (raw.version !== undefined && raw.version !== 1) reasons.push('appearance.version was invalid')

  let custom: CustomThemeConfig | undefined
  if (preset === 'custom' || raw.custom !== undefined) {
    const rawCustom = isRecord(raw.custom) ? raw.custom : {}
    if (raw.custom !== undefined && rawCustom !== raw.custom) reasons.push('appearance.custom was not an object')
    const base = isBuiltInThemePreset(rawCustom.base) ? rawCustom.base : 'tokmon'
    if (rawCustom.base !== undefined && rawCustom.base !== base) reasons.push('custom.base was invalid')
    custom = {
      base,
      light: cleanOverrides(rawCustom.light, 'light', PRESETS[base].light, reasons),
      dark: cleanOverrides(rawCustom.dark, 'dark', PRESETS[base].dark, reasons),
    }
  }

  const appearance: AppearanceConfig = { version: 1, mode, preset, terminal, ...(custom ? { custom } : {}) }
  return { appearance, repaired: reasons.length > 0 || JSON.stringify(raw) !== JSON.stringify(appearance), reasons }
}

export function normalizeAppearance(input: unknown): AppearanceConfig {
  return repairAppearance(input).appearance
}

function addDerived(tokens: ThemeTokens): ResolvedThemeTokens {
  return {
    ...tokens,
    card: mixColors(tokens.panel, tokens.text, 0.06),
    cardHover: mixColors(tokens.panel, tokens.text, 0.1),
    divider: tokens.line,
    track: mixColors(tokens.panel, tokens.text, 0.1),
    accentTint: mixColors(tokens.panel, tokens.accent, 0.14),
    accentOn: contrastRatio(tokens.accent, '#000000') >= contrastRatio(tokens.accent, '#ffffff') ? '#000000' : '#ffffff',
    focusRing: tokens.accent,
  }
}

export function resolveTheme(
  input: AppearanceConfig | unknown,
  systemMode: ResolvedThemeMode = 'dark',
): ResolvedTheme {
  const appearance = normalizeAppearance(input)
  const requestedMode = appearance.mode === 'auto' ? systemMode : appearance.mode
  // The named phosphor preset has no light variant by design. Custom themes may
  // use phosphor as a starting language while supplying paired light overrides.
  const mode: ResolvedThemeMode = isDarkOnlyThemePreset(appearance.preset) ? 'dark' : requestedMode
  const preset = appearance.preset === 'custom' ? (appearance.custom?.base ?? 'tokmon') : appearance.preset
  const base = PRESETS[preset][mode]
  const overrides = appearance.preset === 'custom' ? appearance.custom?.[mode] ?? {} : {}
  return { mode, tokens: addDerived({ ...base, ...overrides }) }
}

export function resolveTerminalTheme(
  input: AppearanceConfig | unknown,
  terminalIsDark = true,
): ResolvedTheme | null {
  const appearance = normalizeAppearance(input)
  if (appearance.terminal === 'off' || appearance.terminal === 'ansi') return null
  return resolveTheme(appearance, appearance.terminal === 'dark' ? 'dark' : appearance.terminal === 'light' ? 'light' : terminalIsDark ? 'dark' : 'light')
}
