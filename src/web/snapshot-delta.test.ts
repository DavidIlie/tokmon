import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from 'effect'
import { SnapshotEventSchema } from '../rpc/contract'
import type { WebAccount, WebSnapshot } from './contract'
import {
  createSnapshotDeltaDecoder,
  createSnapshotDeltaEncoder,
  SnapshotDeltaDesyncError,
} from './snapshot-delta'

const encodeEvent = Schema.encodeUnknownSync(SnapshotEventSchema)
const decodeEvent = Schema.decodeUnknownSync(SnapshotEventSchema)

function account(id: string, overrides: Partial<WebAccount> = {}): WebAccount {
  return {
    id,
    providerId: 'claude',
    name: id,
    color: '#e07a5f',
    homeDir: null,
    hasUsage: true,
    hasBilling: true,
    lastActivityAt: 1_000,
    dashboard: {
      today: { cost: 1, tokens: 10, input: 5, cacheRead: 2, cacheSavings: 0.5 },
      week: { cost: 2, tokens: 20, input: 10, cacheRead: 4, cacheSavings: 1 },
      month: { cost: 3, tokens: 30, input: 15, cacheRead: 6, cacheSavings: 1.5 },
      burnRate: 0.1,
      series: [1, 2, 3],
      lastActivityAt: 1_000,
    },
    table: {
      daily: [{
        label: '2026-08-08', models: ['opus'], input: 5, output: 5, cacheCreate: 1,
        cacheRead: 2, cacheSavings: 0.5, total: 13, cost: 1, count: 2,
        breakdown: [{ name: 'opus', input: 5, output: 5, cacheCreate: 1, cacheRead: 2, cacheSavings: 0.5, cost: 1, count: 2 }],
      }],
      weekly: [],
      monthly: [],
    },
    billing: { plan: 'max', metrics: [], error: null },
    summaryState: 'ready',
    billingState: 'ready',
    tableState: 'ready',
    summaryUpdatedAt: 1_000,
    billingUpdatedAt: 1_000,
    tableUpdatedAt: 1_000,
    ...overrides,
  }
}

function snapshot(accounts: WebAccount[], generatedAt = 1_000): WebSnapshot {
  return {
    version: '0.31.2',
    generatedAt,
    tz: 'UTC',
    intervalMs: 30_000,
    billingIntervalMs: 60_000,
    providers: [{ id: 'claude', name: 'Claude', color: '#e07a5f' }],
    accounts,
    seeded: true,
    peak: null,
  }
}

/** Round-trip through the wire schema exactly as effect rpc's JSON serialization would. */
function overWire(event: unknown): ReturnType<typeof decodeEvent> {
  return decodeEvent(JSON.parse(JSON.stringify(encodeEvent(event))))
}

test('first frame is a full init and decodes to the identical snapshot', () => {
  const encoder = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  const source = snapshot([account('a'), account('b')])

  const event = encoder.next(source)
  assert.equal(event._tag, 'init')
  const decoded = decoder.apply(overWire(event) as never)
  assert.deepEqual(decoded, source)
})

test('an unchanged tick produces an empty delta and a faithful snapshot', () => {
  const encoder = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  const first = snapshot([account('a'), account('b')])
  decoder.apply(overWire(encoder.next(first)) as never)

  // Same account contents (new generatedAt only) — the engine rebuilds account
  // objects every assembleSnapshot, so content-hash equality must catch this.
  const second = snapshot([account('a'), account('b')], 2_000)
  const event = encoder.next(second)
  assert.equal(event._tag, 'delta')
  assert.equal((event as Extract<typeof event, { _tag: 'delta' }>).upserts.length, 0)

  const decoded = decoder.apply(overWire(event) as never)
  assert.deepEqual(decoded, second)
})

test('a changed heavy section ships only that section', () => {
  const encoder = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  const first = snapshot([account('a'), account('b')])
  decoder.apply(overWire(encoder.next(first)) as never)

  const changedDashboard = {
    ...account('a').dashboard!,
    burnRate: 9.9,
  }
  const second = snapshot([account('a', { dashboard: changedDashboard }), account('b')], 2_000)
  const event = encoder.next(second)
  assert.equal(event._tag, 'delta')
  const delta = event as Extract<typeof event, { _tag: 'delta' }>
  assert.equal(delta.upserts.length, 1)
  assert.equal(delta.upserts[0]!.shell.id, 'a')
  assert.ok('dashboard' in delta.upserts[0]!)
  assert.ok(!('table' in delta.upserts[0]!))
  assert.ok(!('billing' in delta.upserts[0]!))

  const decoded = decoder.apply(overWire(event) as never)
  assert.deepEqual(decoded, second)
})

test('shell-only changes (fetch state flip) ship without heavy sections', () => {
  const encoder = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  const base = account('a')
  decoder.apply(overWire(encoder.next(snapshot([base]))) as never)

  const second = snapshot([{ ...base, summaryState: 'error' }], 2_000)
  const event = encoder.next(second)
  const delta = event as Extract<typeof event, { _tag: 'delta' }>
  assert.equal(delta.upserts.length, 1)
  assert.ok(!('dashboard' in delta.upserts[0]!))
  assert.ok(!('table' in delta.upserts[0]!))
  assert.ok(!('billing' in delta.upserts[0]!))
  assert.deepEqual(decoder.apply(overWire(event) as never), second)
})

test('account removal via authoritative order needs no upsert', () => {
  const encoder = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  decoder.apply(overWire(encoder.next(snapshot([account('a'), account('b')]))) as never)

  const second = snapshot([account('b')], 2_000)
  const event = encoder.next(second)
  const delta = event as Extract<typeof event, { _tag: 'delta' }>
  assert.equal(delta.upserts.length, 0)
  const decoded = decoder.apply(overWire(event) as never)
  assert.deepEqual(decoded, second)
  assert.equal(decoded.accounts.length, 1)
})

test('a new account arrives with all sections present', () => {
  const encoder = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  decoder.apply(overWire(encoder.next(snapshot([account('a')]))) as never)

  const second = snapshot([account('a'), account('c', { dashboard: null, table: null, billing: null })], 2_000)
  const event = encoder.next(second)
  const delta = event as Extract<typeof event, { _tag: 'delta' }>
  assert.equal(delta.upserts.length, 1)
  assert.ok('dashboard' in delta.upserts[0]! && 'table' in delta.upserts[0]! && 'billing' in delta.upserts[0]!)
  assert.deepEqual(decoder.apply(overWire(event) as never), second)
})

test('null transitions are sent explicitly, never confused with unchanged', () => {
  const encoder = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  decoder.apply(overWire(encoder.next(snapshot([account('a')]))) as never)

  const second = snapshot([account('a', { billing: null })], 2_000)
  const event = encoder.next(second)
  const delta = event as Extract<typeof event, { _tag: 'delta' }>
  assert.equal(delta.upserts.length, 1)
  assert.ok('billing' in delta.upserts[0]!)
  assert.equal(delta.upserts[0]!.billing, null)
  const decoded = decoder.apply(overWire(event) as never)
  assert.equal(decoded.accounts[0]!.billing, null)
})

test('decoder throws SnapshotDeltaDesyncError on a delta before any init', () => {
  const encoder = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  encoder.next(snapshot([account('a')]))
  const delta = encoder.next(snapshot([account('a')], 2_000))
  assert.throws(() => decoder.apply(overWire(delta) as never), SnapshotDeltaDesyncError)
})

test('decoder throws SnapshotDeltaDesyncError on a frame referencing unknown accounts', () => {
  const encoderA = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  decoder.apply(overWire(encoderA.next(snapshot([account('a')]))) as never)

  // A delta produced against different prior state (simulated lost frame).
  const encoderB = createSnapshotDeltaEncoder()
  encoderB.next(snapshot([account('a'), account('ghost')]))
  const bad = encoderB.next(snapshot([account('a'), account('ghost')], 2_000))
  assert.throws(() => decoder.apply(overWire(bad) as never), SnapshotDeltaDesyncError)
})

test('long stream of mixed mutations stays byte-faithful', () => {
  const encoder = createSnapshotDeltaEncoder()
  const decoder = createSnapshotDeltaDecoder()
  let accounts = [account('a'), account('b'), account('c')]
  let current = snapshot(accounts)
  assert.deepEqual(decoder.apply(overWire(encoder.next(current)) as never), current)

  for (let tick = 1; tick <= 25; tick++) {
    accounts = accounts.map((existing, index) => {
      // Rotate mutations: dashboard churn, billing churn, quota flip, no-op.
      if (tick % 3 === 0 && index === 0) {
        return { ...existing, dashboard: { ...existing.dashboard!, burnRate: tick } }
      }
      if (tick % 4 === 0 && index === 1) {
        return { ...existing, billing: { plan: `plan-${tick}`, metrics: [], error: null } }
      }
      if (tick % 5 === 0 && index === 2) {
        return { ...existing, billingState: tick % 2 ? 'error' as const : 'ready' as const }
      }
      return existing
    })
    if (tick === 10) accounts = accounts.filter(a => a.id !== 'b')
    if (tick === 15) accounts = [...accounts, account('d')]
    current = snapshot(accounts, 1_000 + tick)
    const decoded = decoder.apply(overWire(encoder.next(current)) as never)
    assert.deepEqual(decoded, current, `tick ${tick} diverged`)
  }
})

test('deltas for steady-state ticks are dramatically smaller than full snapshots', () => {
  const encoder = createSnapshotDeltaEncoder()
  const big = snapshot([account('a'), account('b'), account('c')])
  const init = JSON.stringify(encodeEvent(encoder.next(big))).length
  const steady = JSON.stringify(encodeEvent(encoder.next(snapshot([account('a'), account('b'), account('c')], 2_000)))).length
  assert.ok(steady < init / 5, `steady-state delta ${steady}B should be <20% of init ${init}B`)
})
