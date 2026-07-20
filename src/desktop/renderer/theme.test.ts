import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppearanceConfig, ResolvedThemeTokens } from '../../theme'
import { applyDesktopTheme, desktopThemeVariables } from './theme'

const tokens = {
  chrome: '#101010', card: '#202020', cardHover: '#303030', divider: '#404040', track: '#505050',
  text: '#eeeeee', textDim: '#aaaaaa', textFaint: '#777777', accent: '#79be7e', accentTint: '#173d20',
  accentOn: '#000000',
  cost: '#d9c074', positive: '#6caa71', warn: '#e0b84c', crit: '#e5584b',
} as ResolvedThemeTokens

test('desktop theme maps shared semantics without inventing a renderer palette', () => {
  assert.deepEqual(desktopThemeVariables(tokens), {
    '--window': '#101010', '--card': '#202020', '--card-hover': '#303030', '--divider': '#404040',
    '--track': '#505050', '--text-1': '#eeeeee', '--text-2': '#aaaaaa', '--text-3': '#777777',
    '--icon': '#aaaaaa', '--accent': '#79be7e', '--accent-tint': '#173d20', '--accent-on': '#000000', '--chart': '#79be7e',
    '--cost': '#d9c074', '--positive': '#6caa71', '--warn': '#e0b84c', '--crit': '#e5584b',
  })
})

test('theme application targets the document root and records the effective mode', () => {
  const values = new Map<string, string>()
  const root = {
    dataset: {},
    style: { colorScheme: '', setProperty: (name: string, value: string) => values.set(name, value) },
  } as unknown as HTMLElement
  const appearance = { version: 1, mode: 'light', preset: 'tokmon', terminal: 'ansi' } as AppearanceConfig

  const resolved = applyDesktopTheme(root, appearance, 'dark')

  assert.equal(resolved.mode, 'light')
  assert.equal(root.dataset.themePreset, 'tokmon')
  assert.equal(root.dataset.themeMode, 'light')
  assert.ok(values.has('--window'))
})
