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
