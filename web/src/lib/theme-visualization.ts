import type { AppearanceConfig } from '@shared'
import type { Derived } from './derive'

type ThemePreset = AppearanceConfig['preset']

const ACCENT_STEPS = [100, 86, 72, 58, 46, 92, 78, 64, 52, 82, 68, 56]

export function visualizationColor(index: number): string {
  const weight = ACCENT_STEPS[index % ACCENT_STEPS.length]
  return `color-mix(in oklab, var(--color-accent) ${weight}%, var(--color-fg-dim))`
}

/** Single source of truth for the data-ink color rule across every chart and
 * share card. Every ordinary theme (tokmon, custom, and the imported presets)
 * preserves provider/model brand identity; the `phosphor` preset alone
 * deliberately collapses data ink into its terminal-green accent family, so a
 * given series is the same color in every chart of that theme. */
export function usesAccentInk(preset: ThemePreset): boolean {
  return preset === 'phosphor'
}

/** Resolve one series color from the shared rule: the accent-family ramp at
 * `index` for accent-led presets, otherwise the supplied brand color. */
export function dataInkColor(preset: ThemePreset, index: number, brand: string): string {
  return usesAccentInk(preset) ? visualizationColor(index) : brand
}

/** Remap the provider/model series colors carried on `derived` per the shared
 * rule, so charts that read `derived.*.color` directly (donut, cost-by-model,
 * leaderboard) stay consistent with the components that resolve colors via
 * {@link dataInkColor}. */
export function themeVisualization(derived: Derived, appearance: AppearanceConfig): Derived {
  if (!usesAccentInk(appearance.preset)) return derived
  return {
    ...derived,
    byProvider: derived.byProvider.map((item, index) => ({ ...item, color: visualizationColor(index) })),
    byModel: derived.byModel.map((item, index) => ({ ...item, color: visualizationColor(index) })),
  }
}
