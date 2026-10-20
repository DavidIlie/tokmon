import assert from 'node:assert/strict'
import test from 'node:test'
import type { Metric } from './providers/types'
import { blendHeadroom, deriveAccountIdentity, deriveProviderHeadroom, deriveQuotaView, deriveQuotaViews, MIN_STALE_AFTER_MS, projectAccountIdentity, resolveQuotaViews, staleAfterMs, tightestQuotaView, usageFromHeadroom } from './usage-semantics'

const pct = (label: string, used: number, extra: Partial<Metric> = {}): Metric => ({
  label, used, limit: 100, format: { kind: 'percent' }, ...extra,
})

test('quota views invert used exactly once and use canonical provider order', () => {
  const views = deriveQuotaViews([
    pct('Fable', 47, { role: 'model', modelId: 'fable', active: true }),
    pct('Weekly', 62, { role: 'weekly' }),
    pct('Session', 86, { role: 'session', primary: true }),
  ])
  assert.deepEqual(views.map(view => view.label), ['Session', 'Weekly', 'Fable'])
  assert.deepEqual(views.map(view => view.remainingPct), [14, 38, 53])
  assert.equal(views[0]!.valueText, '86% used')
})

test('single and batch quota normalization share one parser', () => {
  const metrics = [
    pct('Weekly usage', 62, { role: 'weekly', resetsAt: '2026-07-20T00:00:00Z' }),
    { label: 'Spend', used: 18, limit: 20, format: { kind: 'dollars' as const } },
  ]
  assert.deepEqual(deriveQuotaViews(metrics).find(view => view.label === 'Weekly'), deriveQuotaView(metrics[0]!, 0))
  assert.equal(tightestQuotaView(deriveQuotaViews(metrics))?.label, 'Spend')
})

test('bounded provider money keeps exact amounts alongside its percentage meter', () => {
  const view = deriveQuotaView({
    key: 'extra_usage', role: 'unbounded', label: 'Extra', used: 3, limit: 100,
    format: { kind: 'dollars', currency: 'usd' },
  })
  assert.equal(view.usedPct, 3)
  assert.equal(view.remainingPct, 97)
  assert.equal(view.valueText, '$3.00 used · $97.00 left')
  assert.deepEqual(view.value, { kind: 'money', used: 3, limit: 100, remaining: 97, currency: 'USD' })
})

test('daemon quota contract wins over conflicting legacy raw metrics', () => {
  const canonical = deriveQuotaViews([pct('Session', 12, { role: 'session' })])
  const resolved = resolveQuotaViews({
    quotas: canonical,
    metrics: [pct('Session', 99, { role: 'session' })],
  })
  assert.deepEqual(resolved, canonical)
  assert.equal(resolveQuotaViews({ metrics: [pct('Session', 99)] })[0]?.usedPct, 99)
})

test('user-facing usage is the exact inverse of daemon headroom', () => {
  assert.equal(usageFromHeadroom(98), 2)
  assert.equal(usageFromHeadroom(0), 100)
  assert.equal(usageFromHeadroom(null), null)
})

test('smart headroom combines session and active model then caps with weekly', () => {
  const quotas = deriveQuotaViews([
    pct('Session', 2, { role: 'session' }),
    pct('Weekly', 62, { role: 'weekly' }),
    pct('Fable', 2, { role: 'model', modelId: 'fable', active: true }),
  ])
  const view = deriveProviderHeadroom([{ id: 'claude', lastActivityAt: 1_000, quotas }], 10, 1_000)
  assert.equal(Math.round(view.value!), 38)
  assert.equal(view.mode, 'smart')
  assert.deepEqual(view.factors.filter(f => f.included).map(f => f.label), ['Session', 'Fable', 'Weekly'])
  assert.match(view.explanation, /Session \+ Fable \+ Weekly/)
})

test('smart provider usage pools matching quota capacity across accounts', () => {
  assert.ok(blendHeadroom(14, 53) <= 14)
  const accounts = [
    { id: 'a', lastActivityAt: 990, quotas: deriveQuotaViews([
      pct('Session', 3, { key: 'session', role: 'session' }),
      pct('Weekly', 62, { key: 'weekly_all', role: 'weekly' }),
      pct('Fable', 100, { key: 'weekly_scoped', role: 'model', modelId: 'fable', active: true }),
    ]) },
    { id: 'b', lastActivityAt: 995, quotas: deriveQuotaViews([
      pct('Session', 17, { key: 'session', role: 'session' }),
      pct('Weekly', 50, { key: 'weekly_all', role: 'weekly' }),
      pct('Fable', 48, { key: 'weekly_scoped', role: 'model', modelId: 'fable' }),
    ]) },
    { id: 'c', lastActivityAt: 0, quotas: deriveQuotaViews([
      pct('Session', 10, { key: 'session', role: 'session' }),
      pct('Weekly', 2, { key: 'weekly_all', role: 'weekly' }),
      pct('Fable', 2, { key: 'weekly_scoped', role: 'model', modelId: 'fable' }),
    ]) },
  ]
  const smart = deriveProviderHeadroom(accounts, 10, 1_000)
  assert.equal(Math.round(usageFromHeadroom(smart.value)!), 51)
  assert.equal(smart.basis, 'active')
  assert.equal(smart.representativeAccountId, null)
  assert.match(smart.explanation, /3 accounts combined/)
  assert.deepEqual(smart.factors.filter(factor => factor.included).map(factor => factor.label), ['Session', 'Fable'])
})

test('one exhausted model reporter cannot exhaust a multi-account provider', () => {
  const accounts = [
    { id: 'fable-user', lastActivityAt: 1_000, quotas: deriveQuotaViews([
      pct('Session', 10, { key: 'session', role: 'session' }),
      pct('Fable', 100, { key: 'fable', role: 'model', modelId: 'fable', active: true }),
    ]) },
    { id: 'other-account', lastActivityAt: 1_000, quotas: deriveQuotaViews([
      pct('Session', 20, { key: 'session', role: 'session' }),
    ]) },
  ]

  const smart = deriveProviderHeadroom(accounts, 10, 1_000)

  assert.equal(Math.round(usageFromHeadroom(smart.value)!), 15)
  assert.deepEqual(smart.factors.filter(factor => factor.included).map(factor => factor.label), ['Session'])
})

test('highest-usage provider summary preserves conservative account selection', () => {
  const a = deriveQuotaViews([pct('Session', 86, { role: 'session' })])
  const b = deriveQuotaViews([pct('Session', 20, { role: 'session' })])
  const active = deriveProviderHeadroom([
    { id: 'a', lastActivityAt: 990, quotas: a },
    { id: 'b', lastActivityAt: 995, quotas: b },
  ], 10, 1_000, 'tightestRemaining')
  assert.equal(active.value, 14)
  assert.equal(active.representativeAccountId, 'a')
})

test('smart generic providers use the declared primary metric, not an auxiliary floor', () => {
  const quotas = deriveQuotaViews([
    pct('Usage', 70, { role: 'other', primary: true }),
    pct('Auto', 60, { role: 'other' }),
    pct('API', 100, { role: 'other' }),
  ])
  const view = deriveProviderHeadroom([{ id: 'cursor', lastActivityAt: null, quotas }], 10, 1_000)
  assert.equal(view.value, 30)
  assert.equal(usageFromHeadroom(view.value), 70)
  assert.equal(view.factors[0]?.label, 'Usage')
  assert.equal(view.factors[0]?.reason, 'primary')
})

test('redaction is reported only when privacy mode is on', () => {
  // Privacy mode always returns the ordinal early, so nothing on the visible
  // path can carry redacted: true. Locks that in, since consumers branch on it.
  const visible = [
    { name: 'Claude Work', email: 'david@example.com', displayName: 'David' },
    { name: '', email: null, displayName: null },
    { name: 'Claude david@example.com', email: 'david@example.com', displayName: null },
  ]
  for (const input of visible) {
    const identity = deriveAccountIdentity({ ...input, providerName: 'Claude', ordinal: 1, privacyMode: false })
    assert.equal(identity.redacted, false, `${input.name || '<empty>'} must not report redaction`)
  }
  assert.equal(
    deriveAccountIdentity({ name: 'Claude Work', providerName: 'Claude', ordinal: 1, privacyMode: true }).redacted,
    true,
  )
})

test('staleness is two missed polls, floored at one default cycle', () => {
  assert.equal(MIN_STALE_AFTER_MS, 300_000)
  assert.equal(staleAfterMs(60_000), 300_000)
  assert.equal(staleAfterMs(300_000), 600_000)
  assert.equal(staleAfterMs(1_800_000), 3_600_000)
  // Legacy snapshots and misconfigured intervals fall back to the default cycle.
  assert.equal(staleAfterMs(undefined), 600_000)
  assert.equal(staleAfterMs(null), 600_000)
  assert.equal(staleAfterMs(0), 600_000)
  assert.equal(staleAfterMs(Number.NaN), 600_000)
})

test('the shared privacy projection agrees with the daemon and distrusts stale identities', () => {
  const daemon = deriveAccountIdentity({
    name: 'Claude Jane Doe', email: null, providerName: 'Claude', ordinal: 2, privacyMode: true,
  })
  const project = (identity: typeof daemon | null) => projectAccountIdentity({
    identity, visible: 'Claude Jane Doe', providerName: 'Claude', ordinal: 2, privacyMode: true,
  })

  assert.equal(project(daemon), daemon.accessibleLabel)
  assert.equal(project(daemon), 'Claude account 2')
  // A snapshot resolved before the toggle, and a snapshot too old to carry one.
  assert.equal(project({ title: 'Jane', subtitle: null, accessibleLabel: 'Jane', redacted: false }), 'Claude account 2')
  assert.equal(project(null), 'Claude account 2')
  // Privacy off hands back the surface's own label untouched.
  assert.equal(projectAccountIdentity({
    identity: null, visible: 'Claude Jane Doe', providerName: 'Claude', ordinal: 2, privacyMode: false,
  }), 'Claude Jane Doe')
})
