import assert from 'node:assert/strict'
import test from 'node:test'
import type { Config, WebSnapshot } from '../../web/contract'
import type { DesktopState } from '../shared/desktop-contract'
import { OptimisticConfigUpdates } from './config-updates'

function snapshot(redacted: boolean): WebSnapshot {
  return {
    version: 'test', generatedAt: 0, tz: 'UTC', intervalMs: 1_000, billingIntervalMs: 60_000,
    providers: [{ id: 'claude', name: 'Claude', color: 'green' }], seeded: true, peak: null,
    accounts: [{
      id: 'a', providerId: 'claude', name: 'Claude', color: 'green', homeDir: null,
      hasUsage: true, hasBilling: true, email: 'a@example.com', displayName: null,
      identity: { title: redacted ? 'Claude account 1' : 'a@example.com', subtitle: null, accessibleLabel: redacted ? 'Claude account 1' : 'a@example.com', redacted },
      lastActivityAt: null, dashboard: null, table: null, billing: null,
      summaryState: 'ready', billingState: 'ready', tableState: 'ready',
      summaryUpdatedAt: null, billingUpdatedAt: null, tableUpdatedAt: null,
    }],
  }
}

function state(revision: number, privacyMode: boolean, snapshotMode?: boolean): DesktopState {
  return {
    appName: 'Tokmon', appVersion: 'test',
    update: { status: 'disabled', availableVersion: null, progressPercent: null, error: null },
    loginItem: { status: 'enabled', enabled: true, error: null },
    snapshot: snapshotMode === undefined ? null : snapshot(snapshotMode), config: { revision, privacyMode } as Config, configRevision: revision,
    connection: 'live', daemon: null, platform: 'darwin', displayWidthPt: 1440,
    systemMode: 'dark', activeAccountIds: [], error: null,
  }
}

const togglePrivacy = (config: Config): Config => ({ ...config, privacyMode: !config.privacyMode })

test('two rapid optimistic toggles survive the first daemon acknowledgement without flicker', () => {
  const updates = new OptimisticConfigUpdates()
  updates.accept(state(10, false))
  const first = updates.enqueue(togglePrivacy)
  const second = updates.enqueue(togglePrivacy)

  assert.equal(first.state?.config?.privacyMode, true)
  assert.equal(second.state?.config?.privacyMode, false)

  const firstWrite = updates.begin(first.id, state(10, false))
  assert.equal(firstWrite.config.privacyMode, true)
  assert.equal(updates.accept(state(11, true)).config?.privacyMode, false)
  assert.equal(updates.complete(first.id, state(11, true)).config?.privacyMode, false)

  const secondWrite = updates.begin(second.id, state(11, true))
  assert.equal(secondWrite.config.privacyMode, false)
  assert.equal(updates.accept(state(12, false)).config?.privacyMode, false)
  assert.equal(updates.complete(second.id, state(12, false)).config?.privacyMode, false)
})

test('an unrelated revision does not consume or erase an optimistic mutation', () => {
  const updates = new OptimisticConfigUpdates()
  updates.accept(state(4, false))
  const pending = updates.enqueue(togglePrivacy)
  updates.begin(pending.id, state(4, false))

  assert.equal(updates.accept(state(5, false)).config?.privacyMode, true)
  const retry = updates.begin(pending.id, state(5, false))
  assert.equal(retry.config.privacyMode, true)
})

test('failed mutation rolls back while preserving later optimistic work', () => {
  const updates = new OptimisticConfigUpdates()
  updates.accept(state(2, false))
  const failed = updates.enqueue(togglePrivacy)
  const later = updates.enqueue(config => ({ ...config, privacyToggleKey: 'x' }))
  updates.begin(failed.id, state(2, false))

  const projected = updates.fail(failed.id, state(2, false))
  assert.equal(projected.config?.privacyMode, false)
  assert.equal(projected.config?.privacyToggleKey, 'x')
  assert.ok(later.id > failed.id)
})

test('a config acknowledgement cannot pair privacy with a stale identity snapshot', () => {
  const updates = new OptimisticConfigUpdates()
  updates.accept(state(8, true, true))
  const first = updates.enqueue(togglePrivacy)
  const second = updates.enqueue(togglePrivacy)
  updates.begin(first.id, state(8, true, true))
  updates.complete(first.id, state(9, false, false))
  updates.begin(second.id, state(9, false, false))

  const staleAck = updates.accept(state(10, true, false))
  assert.equal(staleAck.config?.privacyMode, true)
  assert.equal(staleAck.snapshot?.accounts[0]?.identity?.redacted, true)
})
