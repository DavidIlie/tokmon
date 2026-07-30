import {
  accessibleColor,
  BUILT_IN_THEME_PRESET_IDS,
  contrastRatio,
  DEFAULT_APPEARANCE,
  relativeLuminance,
  resolveTheme,
  themePresetOption,
  type BuiltInThemePreset,
  type ResolvedThemeTokens,
} from '../../../src/theme/index.ts'

export { contrastRatio }

export const DEFAULT_THEME_ID = 'tokmon'
export const THEME_STORAGE_KEY = 'tokmon:site-theme:v1'

export const SITE_THEME_VARS = [
  '--bg-0', '--bg-1', '--bg-2', '--bg-3',
  '--line', '--line-2', '--line-faint',
  '--fg', '--fg-dim', '--fg-faint', '--fg-bright',
  '--accent', '--accent-text', '--cost', '--code-fg', '--positive',
  '--ok', '--warning', '--critical', '--unknown',
  '--accent-tint', '--accent-on', '--focus-ring',
] as const

export type SiteThemeVar = typeof SITE_THEME_VARS[number]

export interface SiteThemeSource {
  id: BuiltInThemePreset
  name: string
  tokens: ResolvedThemeTokens
}

export interface SiteTheme {
  id: string
  name: string
  bg: string
  fg: string
  accent: string
  scheme: 'dark' | 'light'
  vars: Record<SiteThemeVar, string>
}

export const SITE_THEME_SOURCES: readonly SiteThemeSource[] = BUILT_IN_THEME_PRESET_IDS.map(id => ({
  id,
  name: themePresetOption(id).name,
  tokens: resolveTheme({ ...DEFAULT_APPEARANCE, mode: 'dark', preset: id }, 'dark').tokens,
}))

export function deriveSiteTheme(source: SiteThemeSource): SiteTheme {
  const {
    canvas,
    panel,
    inset,
    insetStrong,
    line,
    lineStrong,
    lineFaint,
    text,
    textDim,
    textFaint,
    textStrong,
    accent,
    cost,
    positive,
    ok,
    warn,
    crit,
    unknown,
    accentTint,
    accentOn,
    focusRing,
  } = source.tokens
  const vars: Record<SiteThemeVar, string> = {
    '--bg-0': canvas,
    '--bg-1': panel,
    '--bg-2': inset,
    '--bg-3': insetStrong,
    '--line': line,
    '--line-2': lineStrong,
    '--line-faint': lineFaint,
    '--fg': text,
    '--fg-dim': textDim,
    '--fg-faint': textFaint,
    '--fg-bright': textStrong,
    '--accent': accent,
    '--accent-text': accessibleColor(accent, [canvas, panel], 4.5, text),
    '--cost': cost,
    '--code-fg': accessibleColor(cost, [inset], 4.5, text),
    '--positive': positive,
    '--ok': ok,
    '--warning': warn,
    '--critical': crit,
    '--unknown': unknown,
    '--accent-tint': accentTint,
    '--accent-on': accentOn,
    '--focus-ring': focusRing,
  }
  return {
    id: source.id,
    name: source.name,
    bg: canvas,
    fg: text,
    accent,
    scheme: relativeLuminance(canvas) > 0.5 ? 'light' : 'dark',
    vars,
  }
}

export const SITE_THEMES: readonly SiteTheme[] = SITE_THEME_SOURCES.map(deriveSiteTheme)

export function themeBootstrapData() {
  return {
    vars: SITE_THEME_VARS,
    table: Object.fromEntries(SITE_THEMES.map(theme => [theme.id, SITE_THEME_VARS.map(key => theme.vars[key])])),
    names: Object.fromEntries(SITE_THEMES.map(theme => [theme.id, theme.name])),
    schemes: Object.fromEntries(SITE_THEMES.map(theme => [theme.id, theme.scheme])),
    key: THEME_STORAGE_KEY,
    defaultId: DEFAULT_THEME_ID,
  }
}
