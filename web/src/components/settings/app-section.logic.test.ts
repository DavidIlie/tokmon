import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanProviderSelection,
  defaultMenuBarPresentation,
  toggleMenuBarElement,
  toggleProviderSelection,
} from './app-section.logic'

const known = new Set(['claude', 'codex', 'cursor'])

test('provider selection removes unknowns and preserves ordered unique ids', () => {
  assert.deepEqual(cleanProviderSelection(['codex', 'missing', 'claude', 'codex', 'cursor'], known, 2), ['codex', 'claude'])
})

test('expanded provider selections remain bounded to known providers', () => {
  assert.deepEqual(toggleProviderSelection(['claude'], 'codex', known), ['claude', 'codex'])
  assert.deepEqual(toggleProviderSelection(['claude', 'codex'], 'claude', known), ['codex'])
  assert.deepEqual(toggleProviderSelection(['claude'], 'missing', known), ['claude'])
})

test('menu-bar elements cannot all be hidden', () => {
  const onlyMark = { providerMark: true, value: false, progress: false }
  assert.equal(toggleMenuBarElement(onlyMark, 'providerMark'), onlyMark)
  assert.deepEqual(toggleMenuBarElement(onlyMark, 'value'), {
    providerMark: true,
    value: true,
    progress: false,
  })
})

test('menu-bar reset returns independent presentation objects', () => {
  const first = defaultMenuBarPresentation()
  const second = defaultMenuBarPresentation()
  assert.notEqual(first, second)
  assert.notEqual(first.elements, second.elements)
  assert.notEqual(first.customSpacing, second.customSpacing)
  assert.deepEqual(first, {
    version: 1,
    mode: 'auto',
    elements: { providerMark: true, value: true, progress: false },
    density: 'comfortable',
    customSpacing: { edgePaddingPt: 1, markValueGapPt: 3, providerGapPt: 8 },
  })
})
