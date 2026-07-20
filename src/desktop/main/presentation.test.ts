import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebAccount } from '../../web/contract'
import { formatRemaining, quotaIsStale, tightestQuota } from './presentation'
import { deriveQuotaViews } from '../../usage-semantics'

function account(metrics: NonNullable<WebAccount['billing']>['metrics']): WebAccount {
  return {
    id: 'a', providerId: 'claude', name: 'A', color: '#fff', homeDir: null,
    hasUsage: true, hasBilling: true, lastActivityAt: null,
    dashboard: null, table: null,
    billing: { plan: null, metrics, error: null },
    summaryState: 'ready', billingState: 'ready', tableState: 'ready',
    summaryUpdatedAt: null, billingUpdatedAt: null, tableUpdatedAt: null,
  }
}

test('tightest quota compares bounded percent and absolute metrics by remaining percentage', () => {
  const result = tightestQuota(account([
    { label: 'Session', used: 25, limit: 100, format: { kind: 'percent' } },
    { label: 'Spend', used: 18, limit: 20, format: { kind: 'dollars' } },
  ]))
  assert.equal(result?.label, 'Spend')
  assert.equal(result?.remainingPct, 10)
})

test('unbounded metrics are ignored and equal quotas use the soonest reset', () => {
  const result = tightestQuota(account([
    { label: 'Credits', used: 4, limit: null, format: { kind: 'count' } },
    { label: 'Weekly', used: 40, limit: 100, format: { kind: 'percent' }, resetsAt: '2026-07-20T00:00:00Z' },
    { label: 'Session', used: 40, limit: 100, format: { kind: 'percent' }, resetsAt: '2026-07-14T00:00:00Z' },
  ]))
  assert.equal(result?.label, 'Session')
})

test('remaining formatter preserves unavailable state', () => {
  assert.equal(formatRemaining(null), '—')
  assert.equal(formatRemaining(61.6), '62%')
})

test('desktop main trusts daemon-normalized quotas over conflicting raw billing', () => {
  const value = account([
    { label: 'Session', used: 99, limit: 100, format: { kind: 'percent' } },
  ])
  value.quotas = deriveQuotaViews([
    { label: 'Session', used: 12, limit: 100, format: { kind: 'percent' }, role: 'session' },
  ])
  assert.equal(tightestQuota(value)?.usedPct, 12)
})

test('main-process staleness uses billing as-of time when a legacy snapshot omits cadence', () => {
  const now = 2_000_000
  const value = account([{ label: 'Session', used: 12, limit: 100, format: { kind: 'percent' } }])
  value.billing = { ...value.billing!, asOfMs: now - 11 * 60_000 }
  value.billingUpdatedAt = now
  const snapshot = {
    version: 'test', generatedAt: now, tz: 'UTC', intervalMs: 1_000,
    providers: [], accounts: [value], seeded: true, peak: null,
  }

  assert.equal(quotaIsStale(value, snapshot, now), true)
})
