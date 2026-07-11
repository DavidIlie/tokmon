import test from 'node:test'
import assert from 'node:assert/strict'
import { sharedClaudeCredentialMatches, resetFrom, limitMetric, usageMetric } from './billing'

test('shared Claude credentials require a verified matching alternate account', () => {
  assert.equal(sharedClaudeCredentialMatches(undefined, { accountUuid: 'account-a', email: null }), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', undefined), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', null), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', { accountUuid: 'account-b', email: null }), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', { accountUuid: 'account-a', email: null }), true)
})

test('resetFrom treats small numbers as epoch seconds and large ones as epoch ms', () => {
  const seconds = 1_700_000_000
  const millis = 1_700_000_000_000
  const iso = new Date(millis).toISOString()
  // Same instant expressed in seconds vs milliseconds must yield the same ISO string.
  assert.equal(resetFrom(seconds), iso)
  assert.equal(resetFrom(millis), iso)
})

test('resetFrom routes strings through Date.parse, not the epoch rule', () => {
  // Strings hit the Date.parse branch first, so a bare numeric epoch string is
  // NOT interpreted as seconds/ms — it fails to parse as a date and yields null.
  assert.equal(resetFrom('1700000000'), null)
  assert.equal(resetFrom('1700000000000'), null)
})

test('resetFrom passes through ISO date strings and rejects garbage', () => {
  assert.equal(resetFrom('2026-07-11T00:00:00.000Z'), '2026-07-11T00:00:00.000Z')
  assert.equal(resetFrom('not-a-date'), null)
  assert.equal(resetFrom(undefined), null)
  assert.equal(resetFrom(null), null)
  assert.equal(resetFrom(''), null)
})

test('limitMetric maps percent used against a fixed limit of 100', () => {
  const metric = limitMetric({ percent: 42, kind: 'session' })
  assert.ok(metric)
  assert.equal(metric.label, 'Session')
  assert.equal(metric.used, 42)
  assert.equal(metric.limit, 100)
  assert.deepEqual(metric.format, { kind: 'percent' })
})

test('limitMetric coerces string percent and derives resets_at from epoch seconds', () => {
  const metric = limitMetric({ percent: '55', group: 'weekly_all', resets_at: 1_700_000_000 })
  assert.ok(metric)
  assert.equal(metric.used, 55)
  assert.equal(metric.limit, 100)
  assert.equal(metric.resetsAt, new Date(1_700_000_000_000).toISOString())
})

test('limitMetric returns null when percent or a label is missing', () => {
  assert.equal(limitMetric({ kind: 'session' }), null) // no percent
  assert.equal(limitMetric({ percent: 10 }), null) // no derivable label
  assert.equal(limitMetric(null), null)
})

test('limitMetric flags a primary metric only when requested', () => {
  assert.equal(limitMetric({ percent: 10, kind: 'session' })?.primary, undefined)
  assert.equal(limitMetric({ percent: 10, kind: 'session' }, true)?.primary, true)
})

test('usageMetric maps utilization used against a fixed limit of 100', () => {
  const metric = usageMetric('Session', { utilization: 30, resets_at: 1_700_000_000_000 })
  assert.ok(metric)
  assert.equal(metric.label, 'Session')
  assert.equal(metric.used, 30)
  assert.equal(metric.limit, 100)
  assert.equal(metric.resetsAt, new Date(1_700_000_000_000).toISOString())
})

test('usageMetric returns null when utilization is absent', () => {
  assert.equal(usageMetric('Session', {}), null)
  assert.equal(usageMetric('Session', null), null)
  assert.equal(usageMetric('Session', undefined), null)
})
