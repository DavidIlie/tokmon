import assert from 'node:assert/strict'
import test from 'node:test'
import { isRefreshShortcut } from './refresh-shortcut'

test('accepts either case of the unmodified R shortcut', () => {
  const base = { metaKey: false, ctrlKey: false, altKey: false, target: null }
  assert.equal(isRefreshShortcut({ ...base, key: 'r' }), true)
  assert.equal(isRefreshShortcut({ ...base, key: 'R' }), true)
  assert.equal(isRefreshShortcut({ ...base, key: 'x' }), false)
})

test('does not steal browser or text-entry shortcuts', () => {
  const base = { key: 'r', ctrlKey: false, altKey: false, target: null }
  assert.equal(isRefreshShortcut({ ...base, metaKey: true }), false)
  assert.equal(isRefreshShortcut({
    ...base,
    metaKey: false,
    target: { tagName: 'INPUT' } as unknown as EventTarget,
  }), false)
})
