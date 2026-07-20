import {
  isThemePreset,
  normalizeHexColor,
  resolveTheme,
  validateThemeContrast,
  type AppearanceConfig,
  type EditableThemeTokens,
  type ResolvedThemeTokens,
} from '@shared'

export const THEME_CACHE_KEY = 'tokmon-theme-cache-v1'
export const THEME_CACHE_VERSION = 1

export const THEME_CSS_VARS = {
  canvas: '--color-bg-0',
  panel: '--color-bg-1',
  inset: '--color-bg-2',
  insetStrong: '--color-bg-3',
  line: '--color-line',
  lineStrong: '--color-line-2',
  lineFaint: '--color-line-faint',
  text: '--color-fg',
  textDim: '--color-fg-dim',
  textFaint: '--color-fg-faint',
  textStrong: '--color-fg-bright',
  accent: '--color-accent',
  cost: '--color-cost',
  positive: '--color-positive',
  ok: '--color-ok',
  warn: '--color-warning',
  crit: '--color-critical',
  unknown: '--color-unknown',
  card: '--color-card',
  cardHover: '--color-card-hover',
  divider: '--color-divider',
  track: '--color-track',
  accentTint: '--color-accent-tint',
  accentOn: '--color-accent-on',
  focusRing: '--color-focus-ring',
} satisfies Partial<Record<keyof ResolvedThemeTokens, `--${string}`>>

export type GraphicalMode = 'light' | 'dark'

export interface ResolvedWebTheme {
  appearance: AppearanceConfig
  mode: GraphicalMode
  tokens: ResolvedThemeTokens
}

export interface AppearanceDraftIssue {
  mode: GraphicalMode
  keys: string[]
  message: string
}

interface ThemeCache {
  version: typeof THEME_CACHE_VERSION
  mode: GraphicalMode
  preset: AppearanceConfig['preset']
  vars: Record<string, string>
}

interface StyleTarget {
  setProperty(name: string, value: string): void
  removeProperty(name: string): void
}

interface RootTarget {
  classList: { toggle(name: string, force?: boolean): void }
  dataset: Record<string, string | undefined>
  style: StyleTarget
}

const SAFE_HEX = /^#[0-9a-f]{6}$/i

export function graphicalMode(appearance: AppearanceConfig, systemDark: boolean): GraphicalMode {
  return resolveTheme(appearance, systemDark ? 'dark' : 'light').mode
}

export function resolveWebTheme(appearance: AppearanceConfig, systemDark: boolean): ResolvedWebTheme {
  const resolved = resolveTheme(appearance, systemDark ? 'dark' : 'light')
  return { appearance, ...resolved }
}

export function cssVarsForTheme(tokens: ResolvedThemeTokens): Record<string, string> {
  return Object.fromEntries(
    Object.entries(THEME_CSS_VARS).map(([token, variable]) => [variable, tokens[token as keyof ResolvedThemeTokens]]),
  )
}

export function applyThemeToRoot(root: RootTarget, resolved: ResolvedWebTheme): void {
  root.classList.toggle('light', resolved.mode === 'light')
  root.classList.toggle('dark', resolved.mode === 'dark')
  root.dataset.themeMode = resolved.mode
  root.dataset.themePreset = resolved.appearance.preset
  for (const [name, value] of Object.entries(cssVarsForTheme(resolved.tokens))) root.style.setProperty(name, value)
}

export function themeCacheValue(resolved: ResolvedWebTheme): string {
  return JSON.stringify({
    version: THEME_CACHE_VERSION,
    mode: resolved.mode,
    preset: resolved.appearance.preset,
    vars: cssVarsForTheme(resolved.tokens),
  } satisfies ThemeCache)
}

export function parseThemeCache(raw: string | null): ThemeCache | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<ThemeCache>
    if (value.version !== THEME_CACHE_VERSION) return null
    if (value.mode !== 'light' && value.mode !== 'dark') return null
    if (!isThemePreset(value.preset)) return null
    if (!value.vars || typeof value.vars !== 'object' || Array.isArray(value.vars)) return null
    const expected = new Set<string>(Object.values(THEME_CSS_VARS))
    const entries = Object.entries(value.vars)
    if (entries.length !== expected.size) return null
    if (entries.some(([key, color]) => !expected.has(key) || typeof color !== 'string' || !SAFE_HEX.test(color))) return null
    return value as ThemeCache
  } catch {
    return null
  }
}

export function setThemeMetadata(mode: GraphicalMode, canvas: string): void {
  document.documentElement.style.colorScheme = mode
  document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.setAttribute('content', mode)
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', canvas)
}

export function cacheResolvedTheme(resolved: ResolvedWebTheme): void {
  try { localStorage.setItem(THEME_CACHE_KEY, themeCacheValue(resolved)) } catch { }
}

export function cycleThemeMode(mode: AppearanceConfig['mode']): AppearanceConfig['mode'] {
  return mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto'
}

export function validateAppearanceDraft(appearance: AppearanceConfig): AppearanceDraftIssue[] {
  if (appearance.preset !== 'custom' || !appearance.custom) return []
  return (['light', 'dark'] as const).flatMap(mode => {
    const overrides = appearance.custom?.[mode] ?? {}
    const invalid = Object.entries(overrides).filter((entry): entry is [keyof EditableThemeTokens, string] => normalizeHexColor(entry[1]) === null)
    const issues: AppearanceDraftIssue[] = invalid.map(([key]) => ({ mode, keys: [key], message: 'Use #RRGGBB.' }))
    const safeOverrides = Object.fromEntries(Object.entries(overrides).filter(([, value]) => normalizeHexColor(value) !== null))
    const base = resolveTheme({
      ...appearance,
      preset: 'custom',
      mode,
      custom: { base: appearance.custom!.base, light: {}, dark: {} },
    }, mode).tokens
    for (const failure of validateThemeContrast({ ...base, ...safeOverrides })) {
      issues.push({
        mode,
        keys: [failure.foreground, failure.background],
        message: `${failure.foreground} needs ${failure.minimum}:1 contrast on ${failure.background}.`,
      })
    }
    return issues
  })
}
