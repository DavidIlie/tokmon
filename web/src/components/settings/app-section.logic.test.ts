import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanProviderSelection,
  MAX_PINNED_PROVIDERS,
  moveProviderSelection,
  toggleProviderSelection,
} from './app-section.logic'

const known = new Set(['claude', 'codex', 'cursor'])

test('provider selection removes unknowns and preserves ordered unique pins', () => {
  assert.deepEqual(cleanProviderSelection(['codex', 'missing', 'claude', 'codex', 'cursor'], known, 2), ['codex', 'claude'])
})

test('pin toggles enforce the two-provider maximum', () => {
  assert.deepEqual(toggleProviderSelection(['claude'], 'codex', known, MAX_PINNED_PROVIDERS), ['claude', 'codex'])
  assert.deepEqual(toggleProviderSelection(['claude', 'codex'], 'cursor', known, MAX_PINNED_PROVIDERS), ['claude', 'codex'])
  assert.deepEqual(toggleProviderSelection(['claude', 'codex'], 'claude', known, MAX_PINNED_PROVIDERS), ['codex'])
})

test('pin order can move without changing membership', () => {
  assert.deepEqual(moveProviderSelection(['claude', 'codex'], 'codex', -1), ['codex', 'claude'])
  assert.deepEqual(moveProviderSelection(['claude', 'codex'], 'claude', -1), ['claude', 'codex'])
})
