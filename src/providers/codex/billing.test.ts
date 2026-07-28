import assert from 'node:assert/strict'
import test from 'node:test'
import { codexWindowMetrics, creditBalanceMetric } from './billing'

test('Codex credits remain provider credits instead of invented dollars', () => {
  assert.deepEqual(creditBalanceMetric({ credits: { balance: 314 } }), {
    key: 'credits', role: 'unbounded', label: 'Credits', used: 314, limit: null,
    format: { kind: 'count', suffix: 'available' },
  })
  assert.equal(creditBalanceMetric({ credits: { balance: -1 } }), null)
  assert.equal(creditBalanceMetric({}), null)
})

test('Codex ignores fallback percentage headers when the plan exposes no quota windows', () => {
  const metrics = codexWindowMetrics({}, () => 0)

  assert.deepEqual(metrics, [])
})

test('Codex still uses a fallback percentage header for a real quota window', () => {
  const metrics = codexWindowMetrics({
    primary_window: { limit_window_seconds: 18_000, reset_after_seconds: 3_600 },
  }, name => name === 'x-codex-primary-used-percent' ? 23 : undefined)

  assert.equal(metrics.length, 1)
  assert.equal(metrics[0]?.label, 'Session')
  assert.equal(metrics[0]?.used, 23)
})
