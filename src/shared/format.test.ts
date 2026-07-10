import assert from 'node:assert/strict'
import test from 'node:test'
import { formatResetAt } from './format'

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
