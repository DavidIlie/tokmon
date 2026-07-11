import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudCodeBucketsToMetrics } from './index'
import { resolveGoogleClient, __setDiscoverClientForTest } from './auth'

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

test('failed OAuth-client discovery is retried, then a success is memoized', async () => {
  const oldEnvId = process.env.TOKMON_GOOGLE_CLIENT_ID
  const oldEnvSecret = process.env.TOKMON_GOOGLE_CLIENT_SECRET
  delete process.env.TOKMON_GOOGLE_CLIENT_ID
  delete process.env.TOKMON_GOOGLE_CLIENT_SECRET
  try {
    const good = { clientId: '123456-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' }
    let calls = 0
    // First attempt fails (transient), second succeeds, then discovery would fail
    // again — proving the earlier failure was NOT cached and the success WAS.
    __setDiscoverClientForTest(async () => {
      calls += 1
      return calls === 2 ? good : null
    })

    assert.equal(await resolveGoogleClient(), null, 'first (failed) discovery returns null')
    assert.deepEqual(await resolveGoogleClient(), good, 'retry succeeds instead of staying broken')
    assert.deepEqual(await resolveGoogleClient(), good, 'subsequent calls serve the cached client')
    assert.equal(calls, 2, 'discovery is not re-run once a client is cached')
  } finally {
    __setDiscoverClientForTest(null)
    if (oldEnvId === undefined) delete process.env.TOKMON_GOOGLE_CLIENT_ID
    else process.env.TOKMON_GOOGLE_CLIENT_ID = oldEnvId
    if (oldEnvSecret === undefined) delete process.env.TOKMON_GOOGLE_CLIENT_SECRET
    else process.env.TOKMON_GOOGLE_CLIENT_SECRET = oldEnvSecret
  }
})
