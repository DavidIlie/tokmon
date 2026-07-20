import { isDarkOnlyThemePreset, type AppearanceConfig } from '../../theme'

export type ElectronThemeSource = 'system' | 'light' | 'dark'

/** Phosphor is intentionally a dark instrument. Other presets honor the
 * graphical appearance mode and let Electron follow the OS when set to auto. */
export function electronThemeSource(appearance: AppearanceConfig): ElectronThemeSource {
  if (isDarkOnlyThemePreset(appearance.preset)) return 'dark'
  return appearance.mode === 'auto' ? 'system' : appearance.mode
}

export function effectiveSystemMode(shouldUseDarkColors: boolean): 'light' | 'dark' {
  return shouldUseDarkColors ? 'dark' : 'light'
}
