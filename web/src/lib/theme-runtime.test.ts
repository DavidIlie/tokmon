import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_APPEARANCE, resolveTheme } from '@shared'
import { subscribeSystemTheme } from '../components/theme-provider'
import type { Derived } from './derive'
import {
  applyThemeToRoot,
  cssVarsForTheme,
  cycleThemeMode,
  parseThemeCache,
  resolveWebTheme,
  themeCacheValue,
  validateAppearanceDraft,
} from './theme-runtime'
import { dataInkColor, themeVisualization, usesAccentInk, visualizationColor } from './theme-visualization'

function rootTarget() {
  const classes = new Set<string>()
  const vars = new Map<string, string>()
  return {
    classes,
    vars,
    target: {
      classList: { toggle(name: string, force = !classes.has(name)) { force ? classes.add(name) : classes.delete(name) } },
      dataset: {} as Record<string, string>,
      style: {
        setProperty(name: string, value: string) { vars.set(name, value) },
        removeProperty(name: string) { vars.delete(name) },
      },
    },
  }
}

test('Tokmon resolver application preserves the established dark web palette', () => {
  const resolved = resolveWebTheme({ ...DEFAULT_APPEARANCE, mode: 'dark' }, true)
  const root = rootTarget()
  applyThemeToRoot(root.target, resolved)
  assert(root.classes.has('dark'))
  assert(!root.classes.has('light'))
  assert.equal(root.vars.get('--color-bg-0'), '#0a0a0a')
  assert.equal(root.vars.get('--color-accent'), '#79be7e')
  assert.equal(root.vars.get('--color-critical'), '#e5584b')
  assert.equal(root.vars.get('--color-warning'), '#e0b84c')
  assert.equal(root.target.dataset.themePreset, 'tokmon')
})

test('auto mode follows media changes while Phosphor remains dark-only', () => {
  assert.equal(resolveWebTheme(DEFAULT_APPEARANCE, false).mode, 'light')
  assert.equal(resolveWebTheme(DEFAULT_APPEARANCE, true).mode, 'dark')
  assert.equal(resolveWebTheme({ ...DEFAULT_APPEARANCE, preset: 'phosphor', mode: 'light' }, false).mode, 'dark')
})

test('system theme observer reports initial value, changes, and cleans up', () => {
  let listener: ((event: { matches: boolean }) => void) | null = null
  let removed = false
  const oldWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    matchMedia: () => ({
      matches: false,
      addEventListener: (_: string, next: typeof listener) => { listener = next },
      removeEventListener: () => { removed = true },
    }),
  } })
  const values: boolean[] = []
  const cleanup = subscribeSystemTheme(value => values.push(value))
  assert.deepEqual(values, [false])
  ;(listener as ((event: { matches: boolean }) => void) | null)?.({ matches: true })
  assert.deepEqual(values, [false, true])
  cleanup()
  assert.equal(removed, true)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow })
})

test('first-paint cache accepts a complete resolved palette and rejects tampering', () => {
  const resolved = resolveWebTheme({ ...DEFAULT_APPEARANCE, mode: 'light' }, false)
  const raw = themeCacheValue(resolved)
  const cache = parseThemeCache(raw)
  assert.equal(cache?.mode, 'light')
  assert.deepEqual(cache?.vars, cssVarsForTheme(resolveTheme({ ...DEFAULT_APPEARANCE, mode: 'light' }, 'light').tokens))
  assert.equal(parseThemeCache(raw.replace('#f4f5f5', 'url(javascript:bad)')), null)
  assert.equal(parseThemeCache('{"version":0}'), null)
})

test('first-paint cache accepts imported presets and preserves their resolved surfaces', () => {
  const resolved = resolveWebTheme({ ...DEFAULT_APPEARANCE, preset: 'monokai', mode: 'dark' }, true)
  const cache = parseThemeCache(themeCacheValue(resolved))
  assert.equal(cache?.preset, 'monokai')
  assert.equal(cache?.vars['--color-bg-0'], '#272822')
})

test('preview resolution is local and rollback restores daemon presentation', () => {
  const daemon = { ...DEFAULT_APPEARANCE, mode: 'dark' as const }
  const preview = { ...daemon, preset: 'custom' as const, custom: { base: 'tokmon' as const, light: {}, dark: { accent: '#ff00aa' } } }
  assert.equal(resolveWebTheme(preview, true).tokens.accent, '#ff00aa')
  assert.equal(resolveWebTheme(daemon, true).tokens.accent, '#79be7e')
})

test('custom draft validation checks both variants before one settings save', () => {
  const invalid = {
    ...DEFAULT_APPEARANCE,
    preset: 'custom' as const,
    custom: { base: 'tokmon' as const, light: { text: '#ffffff' }, dark: { accent: 'green' } },
  }
  const issues = validateAppearanceDraft(invalid)
  assert(issues.some(issue => issue.mode === 'light' && issue.keys.includes('text')))
  assert(issues.some(issue => issue.mode === 'dark' && issue.keys.includes('accent')))
})

test('share/chart palette keeps brand hues in every ordinary theme and collapses to accent only for Phosphor', () => {
  const derived = {
    byProvider: [{ id: 'claude', name: 'Claude', color: '#123456', cost: 1, tokens: 2, calls: 3 }],
    byModel: [{ model: 'opus', color: '#abcdef', cost: 1, tokens: 2, cacheSavings: 0, calls: 3, share: 1, tokenShare: 1, callShare: 1, trend: [] }],
  } as unknown as Derived
  // tokmon, custom, and imported presets all preserve provider/model identity.
  assert.equal(themeVisualization(derived, DEFAULT_APPEARANCE), derived)
  assert.equal(themeVisualization(derived, { ...DEFAULT_APPEARANCE, preset: 'monokai' }), derived)
  assert.equal(themeVisualization(derived, { ...DEFAULT_APPEARANCE, preset: 'custom' }), derived)
  // phosphor alone collapses data ink into the accent family.
  const themed = themeVisualization(derived, { ...DEFAULT_APPEARANCE, preset: 'phosphor' })
  assert.match(themed.byProvider[0]!.color, /var\(--color-accent\)/)
  assert.match(themed.byModel[0]!.color, /var\(--color-accent\)/)
})

test('one rule drives both the derived palette and dataInkColor, so charts never disagree', () => {
  const derived = {
    byProvider: [
      { id: 'claude', name: 'Claude', color: '#123456', cost: 1, tokens: 2, calls: 3 },
      { id: 'openai', name: 'OpenAI', color: '#654321', cost: 1, tokens: 2, calls: 3 },
    ],
    byModel: [],
  } as unknown as Derived
  // The rule: only phosphor is accent-led; ordinary themes keep brand hues.
  assert.equal(usesAccentInk('tokmon'), false)
  assert.equal(usesAccentInk('monokai'), false)
  assert.equal(usesAccentInk('custom'), false)
  assert.equal(usesAccentInk('phosphor'), true)

  // Non-phosphor (monokai): donut reads derived.byProvider[i].color (unchanged
  // brand); the provider card resolves via dataInkColor(preset, i, brand). Both
  // land on the same brand color — no split-brain.
  const monokai = themeVisualization(derived, { ...DEFAULT_APPEARANCE, preset: 'monokai' })
  monokai.byProvider.forEach((provider, index) => {
    assert.equal(provider.color, dataInkColor('monokai', index, provider.color))
  })

  // Phosphor: derived palette is remapped to the accent ramp, and dataInkColor
  // returns the same ramp entry for the matching index.
  const phosphor = themeVisualization(derived, { ...DEFAULT_APPEARANCE, preset: 'phosphor' })
  phosphor.byProvider.forEach((provider, index) => {
    assert.equal(provider.color, visualizationColor(index))
    assert.equal(provider.color, dataInkColor('phosphor', index, '#000000'))
  })
})

test('quick toggle cycles Auto, Light, Dark without inventing a fourth state', () => {
  assert.equal(cycleThemeMode('auto'), 'light')
  assert.equal(cycleThemeMode('light'), 'dark')
  assert.equal(cycleThemeMode('dark'), 'auto')
})
