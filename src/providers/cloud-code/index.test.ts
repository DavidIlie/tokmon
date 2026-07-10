import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudCodeBucketsToMetrics } from './index'

test('cloud code quota rejects fractions outside the provider range', () => {
  const metrics = cloudCodeBucketsToMetrics([
    { modelId: 'Gemini Pro', remainingFraction: -0.1 },
    { modelId: 'Gemini Flash', remainingFraction: 1.1 },
    { modelId: 'Gemini Pro', remainingFraction: 0.25 },
  ])

  assert.deepEqual(metrics.map(metric => ({ label: metric.label, used: metric.used })), [
    { label: 'Pro', used: 75 },
  ])
})

test('cloud code quota ignores malformed reset timestamps', () => {
  const [metric] = cloudCodeBucketsToMetrics([
    { modelId: 'Gemini Pro', remainingFraction: 0.5, resetTime: 'not-a-date' },
  ])
  assert.equal(metric.resetsAt, null)
})
