import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILT_IN_THEME_PRESET_IDS,
  contrastRatio,
  DEFAULT_APPEARANCE,
  IMPORTED_THEME_CATALOG,
  IMPORTED_THEME_IDS,
  mixColors,
  normalizeAppearance,
  normalizeHexColor,
  relativeLuminance,
  repairAppearance,
  resolveTerminalTheme,
  resolveTheme,
  THEME_PRESET_OPTIONS,
  validateThemeContrast,
} from './index'

test('Tokmon defaults preserve the existing dark and light palettes', () => {
  assert.deepEqual(DEFAULT_APPEARANCE, { version: 1, mode: 'auto', preset: 'tokmon', terminal: 'ansi' })
  const dark = resolveTheme(DEFAULT_APPEARANCE, 'dark')
  assert.equal(dark.mode, 'dark')
  assert.deepEqual(
    [dark.tokens.canvas, dark.tokens.panel, dark.tokens.chrome, dark.tokens.text, dark.tokens.accent, dark.tokens.cost],
    ['#0a0a0a', '#101011', '#1e1f22', '#d4d6d6', '#79be7e', '#d9c074'],
  )
  const light = resolveTheme(DEFAULT_APPEARANCE, 'light')
  assert.equal(light.mode, 'light')
  assert.deepEqual(
    [light.tokens.canvas, light.tokens.panel, light.tokens.text, light.tokens.accent, light.tokens.cost],
    ['#f4f5f5', '#ffffff', '#2b2e2e', '#2f8f57', '#9a7b1c'],
  )
  assert.deepEqual(validateThemeContrast(dark.tokens), [])
  assert.deepEqual(validateThemeContrast(light.tokens), [])
})

test('phosphor is intentionally dark-only while a custom phosphor base can define light overrides', () => {
  const phosphor = resolveTheme({ ...DEFAULT_APPEARANCE, mode: 'light', preset: 'phosphor' }, 'light')
  assert.equal(phosphor.mode, 'dark')
  assert.equal(phosphor.tokens.canvas, '#000000')
  assert.equal(phosphor.tokens.accent, '#35f38a')

  const custom = resolveTheme({
    ...DEFAULT_APPEARANCE,
    mode: 'light',
    preset: 'custom',
    custom: { base: 'phosphor', light: { accent: '#006b23' }, dark: {} },
  })
  assert.equal(custom.mode, 'light')
  assert.equal(custom.tokens.canvas, '#f3f5f0')
  assert.equal(custom.tokens.accent, '#006b23')
})

test('the full ZeroCut catalog is available as paired, selectable, accessible presets', () => {
  assert.equal(IMPORTED_THEME_IDS.length, 16)
  assert.deepEqual(IMPORTED_THEME_IDS, [
    'vscode', 'monokai', 'dracula', 'github', 'nord', 'one-dark-pro',
    'solarized', 'tokyo-night', 'catppuccin', 'midnight', 'forest',
    'sunset', 'cyberpunk', 'synthwave', 'luxury', 'minimal',
  ])
  assert.equal(THEME_PRESET_OPTIONS.length, BUILT_IN_THEME_PRESET_IDS.length + 1)
  assert.equal(THEME_PRESET_OPTIONS.find(option => option.id === 'monokai')?.name, 'Monokai')
  assert.equal(IMPORTED_THEME_CATALOG.monokai.dark.background, '#272822')
  assert.equal(IMPORTED_THEME_CATALOG.dracula.dark.primary, '#BD93F9')

  for (const preset of BUILT_IN_THEME_PRESET_IDS) {
    for (const mode of ['light', 'dark'] as const) {
      const resolved = resolveTheme({ ...DEFAULT_APPEARANCE, preset, mode }, mode)
      assert.deepEqual(validateThemeContrast(resolved.tokens), [], `${preset} ${mode}`)
    }
  }
})

test('imported palettes retain authored surfaces and can seed editable custom colors', () => {
  const monokai = resolveTheme({ ...DEFAULT_APPEARANCE, preset: 'monokai', mode: 'dark' }, 'dark')
  assert.equal(monokai.tokens.canvas, '#272822')
  assert.equal(monokai.tokens.panel, '#3e3d32')
  assert.equal(monokai.tokens.line, '#75715e')

  const custom = resolveTheme({
    ...DEFAULT_APPEARANCE,
    preset: 'custom',
    mode: 'dark',
    custom: { base: 'monokai', light: {}, dark: { accent: '#ff00aa' } },
  }, 'dark')
  assert.equal(custom.tokens.canvas, monokai.tokens.canvas)
  assert.equal(custom.tokens.accent, '#ff00aa')
})

test('hex normalization, luminance, contrast, and mixing are deterministic and strict', () => {
  assert.equal(normalizeHexColor('#Aa00Ff'), '#aa00ff')
  assert.equal(normalizeHexColor('#fff'), null)
  assert.equal(normalizeHexColor(' #ffffff'), null)
  assert.equal(normalizeHexColor('#gg0000'), null)
  assert.equal(relativeLuminance('#000000'), 0)
  assert.equal(relativeLuminance('#ffffff'), 1)
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
  assert.equal(mixColors('#000000', '#ffffff', 0.5), '#808080')
  assert.throws(() => relativeLuminance('black'), TypeError)
})

test('custom repair canonicalizes valid colors without mutating the input', () => {
  const input = {
    version: 1,
    mode: 'dark',
    preset: 'custom',
    terminal: 'dark',
    custom: {
      base: 'tokmon',
      dark: { canvas: '#001100', text: '#FFFFFF', accent: '#22EE66' },
      light: { canvas: '#FFFFFF', text: '#111111', accent: '#006622' },
    },
  }
  const before = structuredClone(input)
  const repaired = repairAppearance(input)
  assert.deepEqual(input, before)
  assert.equal(repaired.appearance.custom?.dark.canvas, '#001100')
  assert.equal(repaired.appearance.custom?.dark.text, '#ffffff')
  assert.equal(repaired.appearance.custom?.dark.accent, '#22ee66')
  assert.deepEqual(validateThemeContrast(resolveTheme(repaired.appearance, 'dark').tokens), [])
})

test('malformed and low-contrast overrides repair to safe base values', () => {
  const repaired = repairAppearance({
    version: 9,
    mode: 'sepia',
    preset: 'custom',
    terminal: 'rainbow',
    custom: {
      base: 'tokmon',
      dark: { canvas: '#fff', text: '#101011', accent: 'green', ok: '#ffffff' },
      light: null,
    },
  })
  assert.equal(repaired.repaired, true)
  assert.deepEqual(
    { version: repaired.appearance.version, mode: repaired.appearance.mode, terminal: repaired.appearance.terminal },
    { version: 1, mode: 'auto', terminal: 'ansi' },
  )
  assert.deepEqual(repaired.appearance.custom?.dark, {})
  assert.deepEqual(repaired.appearance.custom?.light, {})
  assert.ok(repaired.reasons.some(reason => reason.includes('WCAG') || reason.includes('#RRGGBB')))
  assert.deepEqual(validateThemeContrast(resolveTheme(repaired.appearance, 'dark').tokens), [])
})

test('locked truth colors and derived roles never enter persisted custom overrides', () => {
  const appearance = normalizeAppearance({
    ...DEFAULT_APPEARANCE,
    preset: 'custom',
    custom: { base: 'tokmon', light: { ok: '#ff00ff' }, dark: { crit: '#00ff00' } },
  })
  assert.deepEqual(appearance.custom?.light, {})
  assert.deepEqual(appearance.custom?.dark, {})
  const resolved = resolveTheme(appearance, 'dark').tokens
  assert.equal(resolved.ok, '#79be7e')
  assert.equal(resolved.crit, '#e5584b')
  assert.equal(resolved.divider, resolved.line)
  assert.equal(resolved.focusRing, resolved.accent)
  assert.match(resolved.card, /^#[0-9a-f]{6}$/)
  assert.match(resolved.accentTint, /^#[0-9a-f]{6}$/)
  assert.ok(contrastRatio(resolved.accent, resolved.accentOn) >= 4.5)
})

test('terminal policy leaves ANSI/off alone and explicitly resolves dark/light palettes', () => {
  assert.equal(resolveTerminalTheme(DEFAULT_APPEARANCE), null)
  assert.equal(resolveTerminalTheme({ ...DEFAULT_APPEARANCE, terminal: 'off' }), null)
  assert.equal(resolveTerminalTheme({ ...DEFAULT_APPEARANCE, terminal: 'dark' })?.mode, 'dark')
  assert.equal(resolveTerminalTheme({ ...DEFAULT_APPEARANCE, terminal: 'light' })?.mode, 'light')
})
