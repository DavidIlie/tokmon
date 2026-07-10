import test from 'node:test'
import assert from 'node:assert/strict'
import { codexPriceFor } from './usage'

test('Codex pricing matches current short-context standard rates', () => {
  assert.deepEqual(codexPriceFor('gpt-5.6-sol'), { in: 5e-6, cr: 0.5e-6, out: 30e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.6-terra'), { in: 2.5e-6, cr: 0.25e-6, out: 15e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.6-luna'), { in: 1e-6, cr: 0.1e-6, out: 6e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.5-pro'), { in: 30e-6, cr: 30e-6, out: 180e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.4-mini'), { in: 0.75e-6, cr: 0.075e-6, out: 4.5e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.4-nano'), { in: 0.2e-6, cr: 0.02e-6, out: 1.25e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.4-pro'), { in: 30e-6, cr: 30e-6, out: 180e-6 })
})

test('Codex pricing does not let a shorter family prefix claim a newer model', () => {
  assert.deepEqual(codexPriceFor('openai/gpt-5.6-terra-2026-07-09'), { in: 2.5e-6, cr: 0.25e-6, out: 15e-6 })
})
