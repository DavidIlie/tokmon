import test from 'node:test'
import assert from 'node:assert/strict'
import { geminiPriceFor } from './usage'

test('Gemini pricing matches current standard rates', () => {
  assert.deepEqual(geminiPriceFor('gemini-3.5-flash'), { in: 0.75e-6, out: 4.5e-6, cr: 0.075e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3.1-flash-lite'), { in: 0.25e-6, out: 1.5e-6, cr: 0.025e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3.1-pro-preview'), { in: 2e-6, out: 12e-6, cr: 0.2e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3.1-pro-preview', 200_001), { in: 4e-6, out: 18e-6, cr: 0.4e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3-flash-preview'), { in: 0.5e-6, out: 3e-6, cr: 0.05e-6 })
})
