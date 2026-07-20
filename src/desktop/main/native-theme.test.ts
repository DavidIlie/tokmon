import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppearanceConfig } from '../../theme'
import { effectiveSystemMode, electronThemeSource } from './native-theme'

const appearance = (mode: AppearanceConfig['mode'], preset: AppearanceConfig['preset'] = 'tokmon') =>
  ({ version: 1, mode, preset, terminal: 'ansi' }) as AppearanceConfig

test('native theme follows graphical mode for Tokmon and custom themes', () => {
  assert.equal(electronThemeSource(appearance('auto')), 'system')
  assert.equal(electronThemeSource(appearance('light')), 'light')
  assert.equal(electronThemeSource(appearance('dark', 'custom')), 'dark')
  assert.equal(electronThemeSource(appearance('auto', 'monokai')), 'system')
  assert.equal(electronThemeSource(appearance('light', 'dracula')), 'light')
})

test('Phosphor remains dark-only and system mode is forwarded to the renderer', () => {
  assert.equal(electronThemeSource(appearance('light', 'phosphor')), 'dark')
  assert.equal(effectiveSystemMode(true), 'dark')
  assert.equal(effectiveSystemMode(false), 'light')
})
