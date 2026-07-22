import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXPANDED_PROVIDERS_KEY,
  initialExpandedProviders,
  readExpandedProviders,
  writeExpandedProviders,
  type DisclosureStorage,
} from './disclosure-state'

function memoryStorage(initial: string | null = null): DisclosureStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key) { return key === EXPANDED_PROVIDERS_KEY ? this.value : null },
    setItem(key, value) { if (key === EXPANDED_PROVIDERS_KEY) this.value = value },
  }
}

test('accordion state is a local UI preference with a one-time legacy fallback', () => {
  const known = new Set(['claude', 'codex', 'cursor'])
  const storage = memoryStorage()
  assert.deepEqual(readExpandedProviders(storage, known, ['claude', 'ghost']), ['claude'])

  writeExpandedProviders(storage, ['codex', 'codex', 'ghost'], known)
  assert.equal(storage.value, '["codex"]')
  assert.deepEqual(readExpandedProviders(storage, known, ['claude']), ['codex'])
})

test('malformed local disclosure state fails closed without poisoning provider config', () => {
  const known = new Set(['claude'])
  assert.deepEqual(readExpandedProviders(memoryStorage('{broken'), known, ['claude']), ['claude'])
  assert.deepEqual(readExpandedProviders(memoryStorage('{}'), known, ['claude']), [])
})

test('an explicitly collapsed local state overrides a legacy daemon seed', () => {
  const known = new Set(['claude'])
  assert.deepEqual(readExpandedProviders(memoryStorage('[]'), known, ['claude']), [])
})

test('a lone provider expands only on first run and respects a stored collapse', () => {
  const known = new Set(['claude'])
  assert.deepEqual(initialExpandedProviders(memoryStorage(), known, [], 'claude'), ['claude'])
  assert.deepEqual(initialExpandedProviders(memoryStorage('[]'), known, [], 'claude'), [])
})
