import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanProviderSelection, toggleProviderSelection } from '@shared'

const known = new Set(['claude', 'codex', 'cursor'])

test('provider selection removes unknowns and preserves ordered unique ids', () => {
  assert.deepEqual(cleanProviderSelection(['codex', 'missing', 'claude', 'codex', 'cursor'], known, 2), ['codex', 'claude'])
})

test('expanded provider selections remain bounded to known providers', () => {
  assert.deepEqual(toggleProviderSelection(['claude'], 'codex', known), ['claude', 'codex'])
  assert.deepEqual(toggleProviderSelection(['claude', 'codex'], 'claude', known), ['codex'])
  assert.deepEqual(toggleProviderSelection(['claude'], 'missing', known), ['claude'])
})
