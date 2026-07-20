import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_APPEARANCE } from '../theme'
import { resolveTuiTheme } from './theme'

test('default terminal appearance preserves the existing ANSI theme', () => {
  assert.deepEqual(resolveTuiTheme(DEFAULT_APPEARANCE, false), {
    accent: 'greenBright',
    cost: 'yellow',
    positive: 'green',
    ok: 'green',
    warn: 'yellow',
    crit: 'red',
    unknown: undefined,
  })
})

test('explicit terminal palettes use shared theme tokens', () => {
  const theme = resolveTuiTheme({ ...DEFAULT_APPEARANCE, preset: 'phosphor', terminal: 'dark' }, false)
  assert.equal(theme.accent, '#35f38a')
  assert.equal(theme.cost, '#ffd24a')
  assert.equal(theme.crit, '#ff6b5b')
})

test('NO_COLOR wins over stored terminal appearance', () => {
  const theme = resolveTuiTheme({ ...DEFAULT_APPEARANCE, terminal: 'dark' }, true)
  assert.ok(Object.values(theme).every(value => value === undefined))
})
