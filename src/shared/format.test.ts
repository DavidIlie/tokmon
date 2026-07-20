import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCurrency, formatResetAt, formatResetIn, resetParts } from './format'

test('currency formatting groups spend totals without expanding compact values', () => {
  assert.equal(formatCurrency(1_529.91), '$1,529.91')
  assert.equal(formatCurrency(9_155.45), '$9,155.45')
  assert.equal(formatCurrency(54_400), '$54.4k')
})

test('reset timestamps can render as remaining time or an exact local date', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z')
  const reset = '2026-01-02T03:04:00.000Z'
  assert.equal(formatResetAt(reset, 'relative', now, 'UTC'), '1d 3h')

  const absolute = formatResetAt(reset, 'absolute', now, 'UTC')
  assert.match(absolute, /Jan/)
  assert.match(absolute, /2/)
  assert.match(absolute, /3:04/)
})

test('legacy cached reset labels remain readable', () => {
  assert.equal(formatResetAt('3h 12m', 'relative'), '3h 12m')
  assert.equal(formatResetAt('3h 12m', 'absolute'), '3h 12m')
})

test('resetParts is the one rounding rule: ceil to whole minutes, floored, null once past', () => {
  assert.equal(resetParts(0), null)
  assert.equal(resetParts(-5_000), null)
  assert.equal(resetParts(Number.NaN), null)
  // Any positive remainder rounds up to at least one whole minute.
  assert.deepEqual(resetParts(1_000), { days: 0, hours: 0, minutes: 1, totalMinutes: 1 })
  assert.deepEqual(resetParts(30_000), { days: 0, hours: 0, minutes: 1, totalMinutes: 1 })
  // 3h exactly → no stray minute in the shared arithmetic.
  assert.deepEqual(resetParts(3 * 3_600_000), { days: 0, hours: 3, minutes: 0, totalMinutes: 180 })
  // 90s over 3h ceils the trailing minute up.
  assert.deepEqual(resetParts(3 * 3_600_000 + 90_000), { days: 0, hours: 3, minutes: 2, totalMinutes: 182 })
})

test('formatResetIn derives from resetParts (ceil), agreeing with the desktop compact copy on rounding', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z')
  // Web/TUI keeps its own "3h 0m" style; the shared rounding (ceil) is what
  // matters — the desktop compactDuration reads the same resetParts to render "3h".
  assert.equal(formatResetIn('2026-01-01T03:00:00.000Z', now), '3h 0m')
  assert.equal(formatResetIn('2026-01-01T00:00:30.000Z', now), '1m') // ceil, not 0m
  assert.equal(formatResetIn('2026-01-02T03:04:00.000Z', now), '1d 3h')
  assert.equal(formatResetIn('2026-01-01T00:00:00.000Z', now), 'now')
})
