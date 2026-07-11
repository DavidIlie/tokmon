import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudCodeBucketsToMetrics } from '../cloud-code'

// Antigravity's quota display goes through `cloudCodeBucketsToMetrics(buckets,
// { fullGeminiLabels: true })` (see antigravityBilling).  These tests pin the
// inversion-prone remaining->used percent conversion and the full-label naming
// that path depends on.

test('antigravity quota inverts remaining fraction into used percent', () => {
  // remainingFraction is [0,1] "remaining"; a 25%-remaining bucket must read as
  // 75% used, NOT 25% — the classic used-vs-remaining inversion.
  const [metric] = cloudCodeBucketsToMetrics(
    [{ modelId: 'Gemini 3 Pro', remainingFraction: 0.25 }],
    { fullGeminiLabels: true },
  )
  assert.equal(metric.label, 'Gemini Pro')
  assert.equal(metric.used, 75)
  assert.equal(metric.limit, 100)
  assert.equal(metric.format.kind, 'percent')
  assert.equal(metric.primary, true)
})

test('antigravity full labels distinguish Gemini Pro from Flash', () => {
  const metrics = cloudCodeBucketsToMetrics(
    [
      { modelId: 'Gemini 3 Flash', remainingFraction: 1 },
      { modelId: 'Gemini 3 Pro', remainingFraction: 0 },
    ],
    { fullGeminiLabels: true },
  )
  // Pro sorts first; fully-drained Pro reads 100 used, untouched Flash reads 0.
  assert.deepEqual(
    metrics.map(m => ({ label: m.label, used: m.used })),
    [
      { label: 'Gemini Pro', used: 100 },
      { label: 'Gemini Flash', used: 0 },
    ],
  )
})

test('antigravity pools a model to its worst (highest used) remaining bucket', () => {
  // Multiple buckets for one pool keep the smallest remaining => largest used.
  const [metric] = cloudCodeBucketsToMetrics(
    [
      { modelId: 'Gemini 3 Pro', remainingFraction: 0.9 },
      { modelId: 'Gemini 3 Pro', remainingFraction: 0.1 },
    ],
    { fullGeminiLabels: true },
  )
  assert.equal(metric.label, 'Gemini Pro')
  assert.equal(metric.used, 90)
})

test('antigravity drops buckets whose fraction is outside [0,1]', () => {
  const metrics = cloudCodeBucketsToMetrics(
    [
      { modelId: 'Gemini 3 Pro', remainingFraction: 1.5 },
      { modelId: 'Gemini 3 Flash', remainingFraction: -0.2 },
      { modelId: 'Gemini 3 Flash', remainingFraction: Number.NaN },
    ],
    { fullGeminiLabels: true },
  )
  assert.deepEqual(metrics, [])
})

test('antigravity keeps Claude quota on its own pool', () => {
  const metrics = cloudCodeBucketsToMetrics(
    [
      { modelId: 'Claude Sonnet 4.5', remainingFraction: 0.4 },
      { modelId: 'Gemini 3 Pro', remainingFraction: 0.4 },
    ],
    { fullGeminiLabels: true },
  )
  const claude = metrics.find(m => m.label === 'Claude')
  assert.ok(claude, 'Claude pool is present')
  assert.equal(claude.used, 60)
})
