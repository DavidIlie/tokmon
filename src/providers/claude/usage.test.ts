import test from 'node:test'
import assert from 'node:assert/strict'
import { claudePriceFor } from './usage'

test('Claude pricing distinguishes original and later Opus 4 releases', () => {
  assert.deepEqual(claudePriceFor('claude-opus-4-20250514'), { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 })
  assert.deepEqual(claudePriceFor('claude-opus-4-8'), { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 })
})

test('Claude Sonnet 5 pricing changes on September 1, 2026', () => {
  assert.deepEqual(claudePriceFor('claude-sonnet-5', Date.UTC(2026, 7, 31, 23, 59, 59)), {
    i: 2e-6, o: 10e-6, cc: 2.5e-6, cr: 2e-7,
  })
  assert.deepEqual(claudePriceFor('claude-sonnet-5', Date.UTC(2026, 8, 1)), {
    i: 3e-6, o: 15e-6, cc: 3.75e-6, cr: 3e-7,
  })
})

test('Claude long-context [1m] suffix prices the same as the base model', () => {
  assert.deepEqual(claudePriceFor('claude-opus-4-8[1m]'), claudePriceFor('claude-opus-4-8'))
  // Base opus-4-8 price, not the shorter legacy claude-opus-4 fallback.
  assert.deepEqual(claudePriceFor('claude-opus-4-8[1m]'), { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 })

  // Sonnet 5's [1m] suffix must resolve to its own (date-dependent) key, not zero.
  const before = Date.UTC(2026, 7, 31, 23, 59, 59)
  const after = Date.UTC(2026, 8, 1)
  assert.deepEqual(claudePriceFor('claude-sonnet-5[1m]', before), claudePriceFor('claude-sonnet-5', before))
  assert.deepEqual(claudePriceFor('claude-sonnet-5[1m]', after), claudePriceFor('claude-sonnet-5', after))

  assert.deepEqual(claudePriceFor('claude-fable-5[1m]'), claudePriceFor('claude-fable-5'))
  assert.deepEqual(claudePriceFor('claude-fable-5[1m]'), { i: 10e-6, o: 50e-6, cc: 12.5e-6, cr: 1e-6 })
})

test('Claude pricing falls back to zero for unknown models', () => {
  assert.deepEqual(claudePriceFor('gpt-4o'), { i: 0, o: 0, cc: 0, cr: 0 })
  assert.deepEqual(claudePriceFor('claude-unknown-99'), { i: 0, o: 0, cc: 0, cr: 0 })
  // An unrecognized base with a [1m] tag still resolves to zero, not a partial match.
  assert.deepEqual(claudePriceFor('claude-unknown-99[1m]'), { i: 0, o: 0, cc: 0, cr: 0 })
})
