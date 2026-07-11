import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePlan, planDisplay } from './provider-card.logic'

test('normalizePlan treats absent/empty/whitespace as null and trims otherwise', () => {
  assert.equal(normalizePlan(null), null)
  assert.equal(normalizePlan(undefined), null)
  assert.equal(normalizePlan(''), null)
  assert.equal(normalizePlan('   '), null)
  assert.equal(normalizePlan('Pro'), 'Pro')
  assert.equal(normalizePlan('  Max 20x  '), 'Max 20x')
})

test('planDisplay shows a single account plan in the header', () => {
  assert.deepEqual(planDisplay(['Pro']), { mode: 'header', plan: 'Pro' })
  assert.deepEqual(planDisplay([' Pro ']), { mode: 'header', plan: 'Pro' })
})

test('planDisplay shows nothing when the only plan is absent', () => {
  assert.deepEqual(planDisplay([]), { mode: 'none' })
  assert.deepEqual(planDisplay([null]), { mode: 'none' })
  assert.deepEqual(planDisplay(['']), { mode: 'none' })
})

test('planDisplay shows the common plan when all accounts share it', () => {
  assert.deepEqual(planDisplay(['Max 20x', 'Max 20x']), { mode: 'header', plan: 'Max 20x' })
  assert.deepEqual(planDisplay(['Pro', 'Pro', 'Pro']), { mode: 'header', plan: 'Pro' })
})

test('planDisplay falls back to perRow when plans differ', () => {
  assert.deepEqual(planDisplay(['Max 20x', 'Pro']), { mode: 'perRow', count: 2 })
  assert.deepEqual(planDisplay(['Team', 'Team', null]), { mode: 'perRow', count: 3 })
})

test('planDisplay counts a null among named plans as differing', () => {
  assert.deepEqual(planDisplay(['Pro', null]), { mode: 'perRow', count: 2 })
  assert.deepEqual(planDisplay(['', 'Pro']), { mode: 'perRow', count: 2 })
  assert.deepEqual(planDisplay(['Pro', '  ']), { mode: 'perRow', count: 2 })
})

test('planDisplay shows nothing when every account plan is absent', () => {
  assert.deepEqual(planDisplay([null, null]), { mode: 'none' })
  assert.deepEqual(planDisplay([null, null, null]), { mode: 'none' })
})
