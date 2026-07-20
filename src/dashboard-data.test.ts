import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateDashboardData, cachedTokenPercentage } from './dashboard-data'
import type { DashboardData, UsageSummary } from './types'

const summary = (overrides: Partial<UsageSummary> = {}): UsageSummary => ({
  cost: 0,
  tokens: 0,
  input: 0,
  cacheRead: 0,
  cacheSavings: 0,
  ...overrides,
})

const dashboard = (overrides: Partial<DashboardData> = {}): DashboardData => ({
  today: summary(),
  week: summary(),
  month: summary(),
  burnRate: 0,
  series: [],
  lastActivityAt: null,
  ...overrides,
})

test('aggregateDashboardData totals every dashboard field across accounts', () => {
  const first = dashboard({
    today: summary({ cost: 1, tokens: 2, input: 3, cacheRead: 4, cacheSavings: 5 }),
    week: summary({ cost: 10, tokens: 20, input: 30, cacheRead: 40, cacheSavings: 50 }),
    month: summary({ cost: 100, tokens: 200, input: 300, cacheRead: 400, cacheSavings: 500 }),
    burnRate: 1.25,
    lastActivityAt: 100,
  })
  const second = dashboard({
    today: summary({ cost: 6, tokens: 7, input: 8, cacheRead: 9, cacheSavings: 10 }),
    week: summary({ cost: 60, tokens: 70, input: 80, cacheRead: 90, cacheSavings: 100 }),
    month: summary({ cost: 600, tokens: 700, input: 800, cacheRead: 900, cacheSavings: 1_000 }),
    burnRate: 2.75,
    lastActivityAt: 200,
  })

  assert.deepEqual(aggregateDashboardData([first, second]), dashboard({
    today: summary({ cost: 7, tokens: 9, input: 11, cacheRead: 13, cacheSavings: 15 }),
    week: summary({ cost: 70, tokens: 90, input: 110, cacheRead: 130, cacheSavings: 150 }),
    month: summary({ cost: 700, tokens: 900, input: 1_100, cacheRead: 1_300, cacheSavings: 1_500 }),
    burnRate: 4,
    lastActivityAt: 200,
  }))
})

test('aggregateDashboardData preserves billion-scale token totals and cache inputs', () => {
  const result = aggregateDashboardData([
    dashboard({ month: summary({ tokens: 12_250_000_000, input: 500_000_000, cacheRead: 11_760_000_000, cacheSavings: 53_000 }) }),
    dashboard({ month: summary({ tokens: 2_750_000_000, input: 100_000_000, cacheRead: 2_640_000_000, cacheSavings: 7_000 }) }),
  ])

  assert.equal(result?.month.tokens, 15_000_000_000)
  assert.equal(result?.month.input, 600_000_000)
  assert.equal(result?.month.cacheRead, 14_400_000_000)
  assert.equal(result?.month.cacheSavings, 60_000)
  assert.equal(cachedTokenPercentage(result!.month), 96)
  assert.equal(cachedTokenPercentage(summary()), 0)
  assert.equal(cachedTokenPercentage(summary({ tokens: 10, cacheRead: 12 })), 100)
  assert.equal(cachedTokenPercentage(summary({ tokens: 10, cacheRead: -2 })), 0)
  assert.equal(cachedTokenPercentage(summary({ tokens: Number.NaN, cacheRead: 1 })), 0)
})

test('aggregateDashboardData right-aligns histories with different lengths', () => {
  const result = aggregateDashboardData([
    dashboard({ series: [1, 2, 3, 4] }),
    dashboard({ series: [10, 20] }),
    dashboard({ series: [] }),
  ])

  assert.deepEqual(result?.series, [1, 2, 13, 24])
})

test('aggregateDashboardData ignores missing snapshots and preserves no-data state', () => {
  const only = dashboard({ today: summary({ cost: 42 }), series: [3] })

  assert.deepEqual(aggregateDashboardData([null, only, undefined]), only)
  assert.equal(aggregateDashboardData([]), null)
  assert.equal(aggregateDashboardData([null, undefined]), null)
})

test('aggregateDashboardData does not mutate input snapshots or share their nested data', () => {
  const input = dashboard({
    today: summary({ cost: 1 }),
    series: [1, 2],
    lastActivityAt: 123,
  })
  const before = structuredClone(input)
  const result = aggregateDashboardData([input])!

  result.today.cost = 99
  result.series[0] = 99

  assert.deepEqual(input, before)
})
