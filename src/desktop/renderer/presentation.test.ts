import assert from 'node:assert/strict'
import test from 'node:test'
import type { Config, Metric, WebAccount, WebSnapshot } from '../../web/contract'
import {
  accountFloor,
  accountQuotas,
  compactDuration,
  freshness,
  groupByProvider,
  metricQuota,
  percentText,
  planLabel,
  providerRepresentative,
  providerTodayTokens,
  providerSecondarySummary,
  resetLabel,
  resolveProviderPins,
  severity,
  severityTag,
  snapshotUsageTotals,
  staleAgeLabel,
  tightestQuota,
  togglePin,
  totalsCopy,
  usageDataStatus,
  usageNumberText,
} from './presentation'
import { deriveQuotaViews } from '../../usage-semantics'

const metric = (over: Partial<Metric>): Metric => ({
  label: 'Session', used: 0, limit: 100, format: { kind: 'percent' }, resetsAt: null, ...over,
})

const account = (over: Partial<WebAccount>): WebAccount => ({
  id: 'a', providerId: 'claude', name: 'Claude', color: 'green', homeDir: null,
  hasUsage: true, hasBilling: true, email: 'a@example.com', displayName: null, plan: 'Pro',
  lastActivityAt: null, dashboard: null, table: null,
  billing: { plan: 'Pro', metrics: [], error: null }, summaryState: 'ready', billingState: 'ready',
  tableState: 'ready', summaryUpdatedAt: null, billingUpdatedAt: null, tableUpdatedAt: null, ...over,
})

const snapshot = (accounts: WebAccount[]): WebSnapshot => ({
  version: 't', generatedAt: 0, tz: 'UTC', intervalMs: 1000, billingIntervalMs: 60_000,
  providers: [
    { id: 'claude', name: 'Claude', color: 'green' },
    { id: 'codex', name: 'Codex', color: 'cyan' },
  ],
  accounts, seeded: true, peak: null,
})

const cfg = (tray: Record<string, unknown>): Config => ({ tray } as unknown as Config)

// Test trio from the semantics contract: A no-data, B S96/W69, C S93/F7 (C active), Codex S57.
const NOW = 1_000_000_000_000
const bill = (metrics: Metric[]) => ({ plan: 'Max', metrics, error: null })
const A = account({ id: 'A', providerId: 'claude', billing: bill([]) })
const B = account({ id: 'B', providerId: 'claude', billing: bill([
  metric({ label: 'Session', used: 4 }), metric({ label: 'Weekly', used: 31 }),
]) })
const C = account({ id: 'C', providerId: 'claude', lastActivityAt: NOW - 60_000, billing: bill([
  metric({ label: 'Session', used: 7 }), metric({ label: 'Fable', used: 93 }),
]) })
const CODEX = account({ id: 'D', providerId: 'codex', lastActivityAt: NOW - 60_000, billing: bill([
  metric({ label: 'Session', used: 43 }),
]) })

test('billing freshness uses the provider observation time and a safe legacy cadence', () => {
  const observedAt = NOW - 20 * 60_000
  const stale = account({
    billing: { ...bill([metric({ used: 20 })]), asOfMs: observedAt },
    billingUpdatedAt: NOW,
  })
  const legacySnapshot = { ...snapshot([stale]), billingIntervalMs: undefined }

  assert.equal(freshness(stale, legacySnapshot, NOW), 'stale')
  assert.equal(staleAgeLabel(stale, NOW), 'As of 20m ago')
  assert.equal(freshness(account({ billing: bill([metric({ used: 20 })]), billingUpdatedAt: NOW }), legacySnapshot, NOW), 'live')
})

test('severity uses fixed 25/10 bands with mandatory text tags', () => {
  assert.equal(severity(26), 'ok')
  assert.equal(severity(25), 'warn')
  assert.equal(severity(10), 'crit')
  assert.equal(severity(null), 'unknown')
  assert.equal(severityTag('warn'), 'High')
  assert.equal(severityTag('crit'), 'Very high')
  assert.equal(severityTag('ok'), null)
})

test('metricQuota bounds percent metrics and leaves uncapped spend value-only (no NaN)', () => {
  const weekly = metricQuota(metric({ label: 'Weekly usage', used: 81, format: { kind: 'percent' } }))
  assert.equal(weekly.remaining, 19)
  assert.equal(weekly.used, 81)
  assert.equal(weekly.valueText, '81% used')
  const spend = metricQuota(metric({ label: 'Spend', used: 1.2, limit: null, format: { kind: 'dollars' } }))
  assert.equal(spend.remaining, null)
  assert.ok(spend.valueText.startsWith('$'))
})

test('desktop quotas show authoritative bounded money instead of flattening it to percent copy', () => {
  const extra = metricQuota(metric({
    key: 'extra_usage', role: 'unbounded', label: 'Extra', used: 3, limit: 100,
    format: { kind: 'dollars', currency: 'USD' },
  }))
  assert.equal(extra.used, 3)
  assert.equal(extra.remaining, 97)
  assert.equal(extra.valueText, '$3.00 used · $97.00 left')
})

test('desktop renderer trusts daemon quota order and values over raw billing', () => {
  const value = account({
    quotas: deriveQuotaViews([
      metric({ label: 'Weekly', used: 20, role: 'weekly' }),
      metric({ label: 'Session', used: 10, role: 'session' }),
    ]),
    billing: bill([metric({ label: 'Session', used: 99 })]),
  })
  assert.deepEqual(accountQuotas(value).map(quota => [quota.label, quota.used]), [
    ['Session', 10],
    ['Weekly', 20],
  ])
})

test('reset copy ports OpenUsage compactDuration rules', () => {
  const now = 1_000_000_000_000
  assert.equal(resetLabel(now + 3 * 3_600_000 + 25 * 60_000, now), 'Resets in 3h 25m')
  assert.equal(resetLabel(now + 2 * 60_000, now), 'Resets soon')
  assert.equal(resetLabel(null, now), null)
  assert.equal(compactDuration(23 * 24 * 3600), '23d 0h')
  // Compact style is preserved (drops "0m" at the hour scale) even though the
  // rounding now derives from the shared resetParts rule (see shared/format).
  assert.equal(compactDuration(3 * 3600), '3h')
  assert.equal(compactDuration(30), '1m') // shared ceil: any positive remainder → ≥1m
})

test('compact usage numeral omits the percent glyph and collapses sub-1%', () => {
  assert.equal(usageNumberText(58), '58')
  assert.equal(usageNumberText(0.4), '<1')
  assert.equal(usageNumberText(null), '—')
  assert.equal(percentText(58), '58%')
  assert.equal(percentText(0.4), '<1%')
  assert.equal(percentText(81), '81%')
  assert.equal(percentText(null), '—')
})

test('plan labels drop price trivia and keep plain case', () => {
  assert.equal(planLabel('Pro · $20/mo'), 'Pro')
  assert.equal(planLabel('ChatGPT Pro'), 'ChatGPT Pro')
})

test('accountFloor is the account’s tightest bounded window', () => {
  assert.equal(accountFloor(C)!.label, 'Fable')
  assert.equal(accountFloor(C)!.remaining, 7)
  assert.equal(accountFloor(B)!.remaining, 69)
  assert.equal(accountFloor(A), null) // no bounded window at all
})

test('representative: an active account selects its own floor (tightest active), with exact attribution', () => {
  const rep = providerRepresentative([A, B, C], 10, NOW)
  assert.equal(rep.basis, 'active-floor')
  assert.equal(rep.account?.id, 'C')
  assert.equal(rep.quota?.label, 'Fable') // exact window
  assert.equal(rep.quota?.remaining, 7)
  assert.equal(rep.floorPct, 7) // tightest anywhere
  assert.equal(rep.runwayPct, 69) // best available runway (B)
  assert.equal(rep.dataCount, 2) // A (no data) excluded
  assert.equal(rep.providerActive, true)
})

test('representative: multiple active accounts pick the lowest active floor, never blended', () => {
  const bActive = account({ ...B, lastActivityAt: NOW - 60_000 })
  const rep = providerRepresentative([bActive, C], 10, NOW)
  assert.equal(rep.account?.id, 'C') // 7 < 69
  assert.equal(rep.quota?.remaining, 7)
})

test('representative: with nothing active it reports the best runway (highest floor)', () => {
  const idleC = account({ ...C, lastActivityAt: null })
  const rep = providerRepresentative([A, B, idleC], 10, NOW)
  assert.equal(rep.basis, 'idle-runway')
  assert.equal(rep.account?.id, 'B') // 69 is the best runway
  assert.equal(rep.quota?.remaining, 69)
  assert.equal(rep.floorPct, 7) // 7 still surfaced as the honest tightest
})

test('representative: all-unknown provider is No data, never 0/100', () => {
  const rep = providerRepresentative([A], 10, NOW)
  assert.equal(rep.noData, true)
  assert.equal(rep.quota, null)
  assert.equal(rep.floorPct, null)
})

test('representative: idle ties break on soonest reset, then stable account id', () => {
  const soon = account({ id: 'soon', providerId: 'claude', billing: bill([metric({ label: 'S', used: 50, resetsAt: new Date(NOW + 3_600_000).toISOString() })]) })
  const late = account({ id: 'late', providerId: 'claude', billing: bill([metric({ label: 'S', used: 50, resetsAt: new Date(NOW + 7_200_000).toISOString() })]) })
  // Highest floor is a tie at 50 → soonest reset wins.
  assert.equal(providerRepresentative([late, soon], 10, NOW).account?.id, 'soon')
  const p = account({ id: 'p1', providerId: 'claude', billing: bill([metric({ label: 'S', used: 50 })]) })
  const q = account({ id: 'p2', providerId: 'claude', billing: bill([metric({ label: 'S', used: 50 })]) })
  assert.equal(providerRepresentative([q, p], 10, NOW).account?.id, 'p1') // id tiebreak
})

test('providerSecondarySummary reports two real usage numbers, never an average', () => {
  const rep = providerRepresentative([A, B, C], 10, NOW)
  assert.equal(providerSecondarySummary(rep), 'highest usage 93% · lowest usage 31%')
  // Single-account / agreeing providers get no secondary line.
  assert.equal(providerSecondarySummary(providerRepresentative([CODEX], 10, NOW)), null)
})

test('groupByProvider keeps fixed provider order and detects a shared plan', () => {
  const groups = groupByProvider(snapshot([
    account({ id: 'x1', providerId: 'codex', plan: 'ChatGPT Pro' }),
    account({ id: 'c1', providerId: 'claude', plan: 'Pro' }),
    account({ id: 'c2', providerId: 'claude', plan: 'Max' }),
  ]))
  assert.deepEqual(groups.map(g => g.providerId), ['claude', 'codex'])
  assert.equal(groups[0]!.sharedPlan, null)
  assert.equal(groups[1]!.sharedPlan, 'ChatGPT Pro')
})

test('resolveProviderPins migrates account ids to providers, keeps provider ids, caps/dedupes/orders', () => {
  const snap = snapshot([A, B, C, CODEX])
  // Legacy account-scoped pins migrate to provider ids (dedupe A/B/C → claude).
  assert.deepEqual(resolveProviderPins(cfg({ pins: ['C', 'D'] }), snap), ['claude', 'codex'])
  // A legacy pin on a no-data account still resolves to its provider.
  assert.deepEqual(resolveProviderPins(cfg({ pinnedAccount: 'A' }), snap), ['claude'])
  // Already provider-shaped legacy ids stay valid.
  assert.deepEqual(resolveProviderPins(cfg({ pins: ['codex', 'claude'] }), snap), ['codex', 'claude'])
  // The provider-scoped field is the source of truth once present; order preserved, unknown dropped.
  assert.deepEqual(resolveProviderPins(cfg({ pinnedProviders: ['codex', 'ghost', 'claude'], pins: ['C'] }), snap), ['codex', 'claude'])
  // More than two collapse to two.
  assert.deepEqual(resolveProviderPins(cfg({ pinnedProviders: ['claude', 'codex', 'cursor'] }), snap), ['claude', 'codex'])
})

test('togglePin adds up to two, removes, and rejects a third', () => {
  assert.deepEqual(togglePin([], 'claude'), { pins: ['claude'], rejected: false })
  assert.deepEqual(togglePin(['claude'], 'claude'), { pins: [], rejected: false })
  assert.deepEqual(togglePin(['claude', 'codex'], 'cursor'), { pins: ['claude', 'codex'], rejected: true })
})

test('token labels share a stable menu-bar slot and daily totals sum across accounts', () => {
  const tokens = (value: number) => ({ cost: 0, tokens: value, input: value, cacheRead: 0, cacheSavings: 0 })
  const first = account({ dashboard: { today: tokens(1_000_000), week: tokens(1_000_000), month: tokens(1_000_000), burnRate: 0, series: [], lastActivityAt: null } })
  const second = account({ id: 'b', dashboard: { today: tokens(200_000), week: tokens(200_000), month: tokens(200_000), burnRate: 0, series: [], lastActivityAt: null } })
  assert.equal(providerTodayTokens([first, second]), 1_200_000)
  assert.equal(providerTodayTokens([account({ dashboard: null })]), null)
})

test('cross-provider totals use canonical dashboard aggregation and shared freshness', () => {
  const usage = (cost: number, tokens: number) => ({ cost, tokens, input: 0, cacheRead: 0, cacheSavings: 0 })
  const dashboard = (cost: number, tokens: number) => ({
    today: usage(cost, tokens), week: usage(cost * 2, tokens * 2), month: usage(cost * 3, tokens * 3),
    burnRate: 0, series: [], lastActivityAt: null,
  })
  const first = account({ dashboard: dashboard(1, 2) })
  const second = account({ id: 'b', providerId: 'codex', dashboard: dashboard(10, 20) })
  const identityOnly = account({ id: 'c', hasUsage: false, dashboard: dashboard(100, 200) })
  const totals = snapshotUsageTotals(snapshot([first, second, identityOnly]))
  assert.equal(totals?.dashboard?.today.cost, 11)
  assert.equal(totals?.dashboard?.today.tokens, 22)
  assert.equal(totals?.accounts.length, 2)
  assert.match(totalsCopy(totals!.dashboard!).primary, /Total today \$11\.00 · 22 tokens/)
  assert.equal(usageDataStatus([first, second], 1_000, NOW), null)
  assert.equal(usageDataStatus([first, account({ id: 'missing', dashboard: null })], 1_000, NOW), 'Partial usage data')
})
