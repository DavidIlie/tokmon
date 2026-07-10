import test from 'node:test'
import assert from 'node:assert/strict'
import { timestampMs } from './time'

test('timestampMs accepts seconds, milliseconds, numeric strings, and ISO timestamps', () => {
  assert.equal(timestampMs(1_700_000_000), 1_700_000_000_000)
  assert.equal(timestampMs('1700000000000'), 1_700_000_000_000)
  assert.equal(timestampMs('2026-07-09T12:00:00Z'), Date.parse('2026-07-09T12:00:00Z'))
})

test('timestampMs rejects invalid and out-of-range timestamps', () => {
  assert.equal(timestampMs(''), null)
  assert.equal(timestampMs('not-a-date'), null)
  assert.equal(timestampMs(-1), null)
  assert.equal(timestampMs(Number.POSITIVE_INFINITY), null)
})
