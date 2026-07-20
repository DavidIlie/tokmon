import assert from 'node:assert/strict'
import test from 'node:test'
import { isPrivacyShortcut } from './privacy-shortcut'

const base = { metaKey: false, ctrlKey: false, altKey: false, repeat: false, target: null }

test('privacy shortcut follows the configured key case-insensitively', () => {
  assert.equal(isPrivacyShortcut({ ...base, key: 'p' }, 'P'), true)
  assert.equal(isPrivacyShortcut({ ...base, key: 'P' }, 'p'), true)
  assert.equal(isPrivacyShortcut({ ...base, key: 'x' }, 'p'), false)
  assert.equal(isPrivacyShortcut({ ...base, key: 'p' }, ''), false)
  assert.equal(isPrivacyShortcut({ ...base, key: ' ' }, ' '), true)
})

test('privacy shortcut ignores modifiers, repeats, and editable targets', () => {
  assert.equal(isPrivacyShortcut({ ...base, key: 'p', metaKey: true }, 'p'), false)
  assert.equal(isPrivacyShortcut({ ...base, key: 'P', shiftKey: true }, 'p'), false)
  assert.equal(isPrivacyShortcut({ ...base, key: 'p', repeat: true }, 'p'), false)
  assert.equal(isPrivacyShortcut({ ...base, key: 'p', target: { tagName: 'INPUT' } as unknown as EventTarget }, 'p'), false)
  assert.equal(isPrivacyShortcut({ ...base, key: 'p', target: { isContentEditable: true } as unknown as EventTarget }, 'p'), false)
})
