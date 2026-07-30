import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePlan, planDisplay, billingStaleLabel } from './provider-card.logic'
import { MIN_STALE_AFTER_MS, staleAfterMs } from '../usage-semantics'

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

test('billingStaleLabel flags only data older than the stale threshold', () => {
  const now = 1_783_800_000_000
  const threshold = staleAfterMs(300_000)
  assert.equal(billingStaleLabel(null, now, 300_000), null)
  assert.equal(billingStaleLabel(undefined, now, 300_000), null)
  assert.equal(billingStaleLabel(0, now, 300_000), null)
  assert.equal(billingStaleLabel(now, now, 300_000), null)
  assert.equal(billingStaleLabel(now - threshold + 1, now, 300_000), null)
  assert.equal(billingStaleLabel(now - threshold, now, 300_000), 'as of 10m ago')
  assert.equal(billingStaleLabel(now - 10 * 3_600_000, now, 300_000), 'as of 10h ago')
})

test('billingStaleLabel follows the configured billing interval', () => {
  const now = 1_783_800_000_000
  // Two missed polls at a 30-minute interval; the same age is not yet stale there.
  assert.equal(billingStaleLabel(now - 3_600_000, now, 1_800_000), 'as of 1h ago')
  assert.equal(billingStaleLabel(now - 3_599_000, now, 1_800_000), null)
  // A one-minute interval cannot flag data sooner than the shared floor.
  assert.equal(billingStaleLabel(now - MIN_STALE_AFTER_MS, now, 60_000), 'as of 5m ago')
  assert.equal(billingStaleLabel(now - MIN_STALE_AFTER_MS + 1, now, 60_000), null)
  // No interval known (legacy snapshot) falls back to the default cycle.
  assert.equal(billingStaleLabel(now - 600_000, now), 'as of 10m ago')
  assert.equal(billingStaleLabel(now - 599_000, now), null)
})
