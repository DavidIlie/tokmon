import { resolveTheme, type AppearanceConfig, type ResolvedThemeTokens } from '../../theme'

export type SystemColorMode = 'light' | 'dark'

/** The desktop popover keeps its native layout language while consuming the
 * exact same semantic palette as web and TUI. No renderer-local theme values. */
export function desktopThemeVariables(tokens: ResolvedThemeTokens): Readonly<Record<string, string>> {
  return {
    '--window': tokens.chrome,
    '--card': tokens.card,
    '--card-hover': tokens.cardHover,
    '--divider': tokens.divider,
    '--track': tokens.track,
    '--text-1': tokens.text,
    '--text-2': tokens.textDim,
    '--text-3': tokens.textFaint,
    '--icon': tokens.textDim,
    '--accent': tokens.accent,
    '--accent-tint': tokens.accentTint,
    '--accent-on': tokens.accentOn,
    '--chart': tokens.accent,
    '--cost': tokens.cost,
    '--positive': tokens.positive,
    '--warn': tokens.warn,
    '--crit': tokens.crit,
  }
}

export function applyDesktopTheme(
  root: HTMLElement,
  appearance: AppearanceConfig,
  systemMode: SystemColorMode,
): ReturnType<typeof resolveTheme> {
  const resolved = resolveTheme(appearance, systemMode)
  root.dataset.themePreset = appearance.preset
  root.dataset.themeMode = resolved.mode
  root.style.colorScheme = resolved.mode
  for (const [name, value] of Object.entries(desktopThemeVariables(resolved.tokens))) {
    root.style.setProperty(name, value)
  }
  return resolved
}
