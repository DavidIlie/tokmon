import assert from 'node:assert/strict'
import test from 'node:test'
import { creditBalanceMetric } from './billing'

test('Codex credits remain provider credits instead of invented dollars', () => {
  assert.deepEqual(creditBalanceMetric({ credits: { balance: 314 } }), {
    key: 'credits', role: 'unbounded', label: 'Credits', used: 314, limit: null,
    format: { kind: 'count', suffix: 'available' },
  })
  assert.equal(creditBalanceMetric({ credits: { balance: -1 } }), null)
  assert.equal(creditBalanceMetric({}), null)
})
