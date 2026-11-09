import assert from 'node:assert/strict'
import test from 'node:test'
import type { BillingResult, WebAccount, WebSnapshot } from '../../web/contract'
import { deriveProviderHeadroom, deriveQuotaViews } from '../../usage-semantics'
import { freshness, providerFreshness } from './presentation'
import { providerTooltipLine } from '../main/presentation'

const now = 10_000_000
const snapshot = { billingIntervalMs: 60_000 } as WebSnapshot
const billing = (used: number, asOfMs = now): BillingResult => ({
  plan: null, error: null, asOfMs,
  metrics: [{ label: 'Session', used, limit: 100, format: { kind: 'percent' }, role: 'session' }],
})
const account = (id: string, result: BillingResult | null): WebAccount => ({
  id, providerId: 'claude', name: id, color: '#fff', homeDir: null,
  hasUsage: false, hasBilling: true, lastActivityAt: null,
  dashboard: null, table: null, billing: result,
  summaryState: 'ready', billingState: 'ready', tableState: 'ready',
  summaryUpdatedAt: null, billingUpdatedAt: now, tableUpdatedAt: null,
})
const headroom = (accounts: WebAccount[], mode: 'smartHeadroom' | 'tightestRemaining' = 'smartHeadroom') => deriveProviderHeadroom(
  accounts.map(value => ({ ...value, quotas: deriveQuotaViews(value.billing?.metrics ?? []) })), 10, now, mode,
)

test('returned provider failures are errors even after a successful fetch', () => {
  for (const error of ['Invalid API key', 'Account unavailable', '']) {
    assert.equal(freshness(account('failed', { plan: null, metrics: [], error }), snapshot, now), 'error')
  }
  assert.equal(freshness(account('waiting', {
    plan: null, metrics: [], error: 'Awaiting fresh quota observations from CLIProxy',
  }), snapshot, now), 'nodata')
  assert.equal(freshness(account('empty', { plan: null, metrics: [], error: null }), snapshot, now), 'nodata')
  assert.equal(freshness({ ...account('failed-fetch', billing(20)), billingState: 'error' }, snapshot, now), 'error')
  assert.equal(freshness(account('partial', { ...billing(20), error: 'Some metrics unavailable' }), snapshot, now), 'live')
})

test('pooled freshness counts all eight contributors regardless of quota order', () => {
  for (const freshUsed of [0, 100]) {
    const accounts = Array.from({ length: 8 }, (_, index) => account(String(index),
      billing(index === 0 ? freshUsed : 50, index === 0 ? now : now - 3_600_000)))
    for (const ordered of [accounts, [...accounts].reverse()]) {
      const status = providerFreshness(ordered, snapshot, now, headroom(ordered))
      assert.equal(status.state, 'partial')
      assert.equal(status.label, '7 of 8 stale')
      assert.match(status.title!, /7 of 8.*quota observations.*1h.*old/i)
    }
  }
})

test('provider freshness distinguishes all stale, all fresh and no contributors', () => {
  for (const [asOfMs, state, label] of [[now - 3_600_000, 'stale', 'Stale'], [now, 'live', null]] as const) {
    const accounts = [account('a', billing(10, asOfMs)), account('b', billing(90, asOfMs))]
    const status = providerFreshness(accounts, snapshot, now, headroom(accounts))
    assert.equal(status.state, state)
    assert.equal(status.label, label)
  }
  const accounts = [account('empty', null)]
  assert.equal(providerFreshness(accounts, snapshot, now, headroom(accounts)).state, 'nodata')
})

test('single-account headline freshness follows only its representative', () => {
  const accounts = [account('fresh', billing(0)), account('stale', billing(90, now - 3_600_000))]
  const status = providerFreshness(accounts, snapshot, now, headroom(accounts, 'tightestRemaining'))
  assert.equal(status.state, 'live')
  assert.equal(status.totalCount, 1)
})

test('freshness excludes accounts whose unique model quota is not pooled', () => {
  const modelOnly = account('model-only', {
    plan: null, error: null, asOfMs: now - 3_600_000,
    metrics: [{ label: 'Unique', used: 10, limit: 100, format: { kind: 'percent' }, role: 'model', modelId: 'unique' }],
  })
  const accounts = [account('a', billing(10)), account('b', billing(30)), modelOnly, account('empty', null)]
  const status = providerFreshness(accounts, snapshot, now, headroom(accounts))
  assert.equal(status.state, 'live')
  assert.equal(status.totalCount, 2)
})

test('tooltip freshness agrees with the popover for pooled and representative headlines', () => {
  const accounts = [account('fresh', billing(0)), account('old', billing(90, now - 3_600_000))]
  const pooled = headroom(accounts)
  const status = providerFreshness(accounts, snapshot, now, pooled)
  const line = providerTooltipLine('Claude', accounts, false, snapshot, 10, now, pooled)
  assert.ok(line.includes(status.label!))
  assert.ok(line.includes(status.title!))
  assert.match(line, /1 of 2 stale/)
  assert.doesNotMatch(providerTooltipLine('Claude', accounts, false, snapshot, 10, now, headroom(accounts, 'tightestRemaining')), /stale/i)

  const stale = [account('old', billing(90, now - 3_600_000))]
  assert.match(providerTooltipLine('Claude', stale, false, snapshot, 10, now), /Stale.*Quota observation is 1h old/)
})

test('quota age uses proxy observation time before the latest successful fetch', () => {
  const value = account('old', billing(50, now - 300_001))
  assert.equal(freshness(value, snapshot, now), 'stale')
  assert.equal(freshness({ ...value, billing: { ...value.billing!, asOfMs: now - 300_000 } }, snapshot, now), 'live')
  assert.equal(freshness({ ...value, billing: { ...value.billing!, asOfMs: undefined } }, snapshot, now), 'live')
})
