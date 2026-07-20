import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_FILTERS, PERIODS, rangeStartOf } from './derive.filters'

test('range choices expose real six-month and all-time periods', () => {
  assert.deepEqual(
    PERIODS.map(({ key, shortLabel }) => [key, shortLabel]),
    [
      ['7d', '7d'],
      ['30d', '30d'],
      ['90d', '90d'],
      ['mtd', 'MTD'],
      ['6m', '6M'],
      ['all', 'All'],
    ],
  )
  assert.equal(DEFAULT_FILTERS.period, '6m')
})

test('six-month range has a calendar boundary while all time is unbounded', () => {
  assert.equal(rangeStartOf('6m', '2026-07-17', 'UTC'), '2026-01-17')
  assert.equal(rangeStartOf('6m', '2026-03-31', 'UTC'), '2025-09-30')
  assert.equal(rangeStartOf('all', '2026-07-17', 'UTC'), null)
})
