import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Schema } from 'effect'
import { DEFAULTS, loadConfig, normalizeConfig, PROVIDER_IDS, saveConfig } from './config'
import {
  describeConfigUpdateFailure,
  reconcileDaemonConfig,
  reconcileSettingsDraft,
} from './config-sync'
import { ConfigSchema, ConfigStateSchema, WebSnapshotSchema } from './rpc/contract'
import {
  applyConfigUpdate,
  ConfigConflictError,
  ConfigPersistenceError,
} from './web/config-control'
import { createDaemonRpcClient } from './client/daemon-rpc-client'
import { startWebServer } from './web/server'

test('the RPC config schema rejects malformed config documents', () => {
  assert.throws(() => Schema.decodeUnknownSync(ConfigSchema)({ ...DEFAULTS, interval: 'fast' }))
  assert.throws(() => Schema.decodeUnknownSync(ConfigSchema)({
    ...DEFAULTS,
    accounts: [{ id: 'a', name: 'A', homeDir: '~', providerId: 'not-a-provider' }],
  }))
})

test('allowed hosts are normalized as exact DNS hostnames', () => {
  assert.deepEqual(normalizeConfig({
    ...DEFAULTS,
    allowedHosts: [' Tokmon.Example.COM ', 'tokmon.example.com', 'bad/path', '', 42],
  }).allowedHosts, ['tokmon.example.com'])
})

test('the RPC snapshot schema rejects incomplete streamed snapshots', () => {
  assert.throws(() => Schema.decodeUnknownSync(WebSnapshotSchema)({
    version: 'test', generatedAt: Date.now(), tz: 'UTC', intervalMs: 1000,
  }))
  assert.doesNotThrow(() => Schema.decodeUnknownSync(WebSnapshotSchema)({
    version: 'test',
    generatedAt: Date.now(),
    tz: 'UTC',
    intervalMs: 1000,
    providers: [],
    accounts: [],
    seeded: true,
    peak: { state: 'off-peak', label: 'Off-Peak', minutesUntilChange: 1.5 },
  }))
})

test('the RPC config state rejects incompatible protocol versions', () => {
  assert.throws(() => Schema.decodeUnknownSync(ConfigStateSchema)({
    protocol: { version: 2, capabilities: ['config-cas', 'config-revision'] },
    config: DEFAULTS,
  }))
  assert.doesNotThrow(() => Schema.decodeUnknownSync(ConfigStateSchema)({
    protocol: { version: 3, capabilities: ['config-cas', 'config-revision', 'allowed-hosts', 'future-addition'] },
    config: DEFAULTS,
  }))
})

test('saveConfig surfaces failures and later writes can recover', async () => {
  const previous = process.env.XDG_CONFIG_HOME
  const root = await mkdtemp(join(tmpdir(), 'tokmon-config-test-'))
  const blocked = join(root, 'blocked')
  await writeFile(blocked, 'not a directory')
  try {
    process.env.XDG_CONFIG_HOME = blocked
    await assert.rejects(saveConfig(DEFAULTS))

    const writable = join(root, 'config')
    process.env.XDG_CONFIG_HOME = writable
    await saveConfig({ ...DEFAULTS, revision: 1 })
    const dir = join(writable, 'tokmon')
    const file = join(dir, 'config.json')
    assert.equal((await stat(dir)).mode & 0o777, 0o700)
    assert.equal((await stat(file)).mode & 0o777, 0o600)

    // Loading a config written by an older release tightens its permissions
    // even when the document itself needs no repair.
    await chmod(dir, 0o755)
    await chmod(file, 0o644)
    await loadConfig()
    assert.equal((await stat(dir)).mode & 0o777, 0o700)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('stale config revisions conflict before persistence or broadcast', async () => {
  const state = { config: { ...DEFAULTS, revision: 4 } }
  let configured = false
  let broadcast = false
  const engine = {
    setConfig: () => { configured = true },
    broadcastConfig: () => { broadcast = true },
  } as never

  await assert.rejects(
    applyConfigUpdate(engine, state, { expectedRevision: 3, config: state.config }),
    ConfigConflictError,
  )
  assert.equal(state.config.revision, 4)
  assert.equal(configured, false)
  assert.equal(broadcast, false)
})

test('failed persistence leaves daemon state and subscribers untouched', async () => {
  const previous = process.env.XDG_CONFIG_HOME
  const root = await mkdtemp(join(tmpdir(), 'tokmon-config-failure-'))
  const blocked = join(root, 'blocked')
  await writeFile(blocked, 'not a directory')
  const state = { config: { ...DEFAULTS } }
  let configured = false
  let broadcast = false
  const engine = {
    setConfig: () => { configured = true },
    broadcastConfig: () => { broadcast = true },
  } as never

  try {
    process.env.XDG_CONFIG_HOME = blocked
    await assert.rejects(
      applyConfigUpdate(engine, state, {
        expectedRevision: 0,
        config: { ...DEFAULTS, privacyMode: false },
      }),
      ConfigPersistenceError,
    )
    assert.equal(state.config.revision, 0)
    assert.equal(configured, false)
    assert.equal(broadcast, false)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent updates from the same revision have exactly one winner', async () => {
  const previous = process.env.XDG_CONFIG_HOME
  const root = await mkdtemp(join(tmpdir(), 'tokmon-config-cas-'))
  await mkdir(root, { recursive: true })
  const state = { config: { ...DEFAULTS } }
  let broadcasts = 0
  const engine = {
    setConfig: () => {},
    broadcastConfig: () => { broadcasts++ },
  } as never

  try {
    process.env.XDG_CONFIG_HOME = root
    const results = await Promise.allSettled([
      applyConfigUpdate(engine, state, {
        expectedRevision: 0,
        config: { ...DEFAULTS, privacyMode: false },
      }),
      applyConfigUpdate(engine, state, {
        expectedRevision: 0,
        config: { ...DEFAULTS, interval: 9 },
      }),
    ])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const rejected = results.find(result => result.status === 'rejected')
    assert.ok(rejected && rejected.status === 'rejected')
    assert.ok(rejected.reason instanceof ConfigConflictError)
    assert.equal(state.config.revision, 1)
    assert.equal(broadcasts, 1)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('RPC transports revisions and typed conflicts end to end', async (t) => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME
  const previousWebMode = process.env.TOKMON_WEB_MODE
  const root = await mkdtemp(join(tmpdir(), 'tokmon-config-rpc-'))
  const token = 'r'.repeat(43)
  let server: Awaited<ReturnType<typeof startWebServer>> | null = null
  let client: ReturnType<typeof createDaemonRpcClient> | null = null
  try {
    process.env.XDG_CONFIG_HOME = root
    process.env.TOKMON_WEB_MODE = 'prod'
    try {
      server = await startWebServer({
        config: { ...DEFAULTS, disabledProviders: [...PROVIDER_IDS] },
        port: 0,
        wsToken: token,
      })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('the sandbox disallows binding ephemeral loopback ports')
        return
      }
      throw cause
    }
    client = createDaemonRpcClient(server.url, { transport: 'node' })
    const initial = await client.getConfig()
    assert.equal(initial.protocol.version, 3)
    assert.equal(initial.config.revision, 0)

    const saved = await client.setConfig({
      expectedRevision: 0,
      config: { ...initial.config, privacyMode: false },
    })
    assert.equal(saved.config.revision, 1)
    assert.equal(saved.config.privacyMode, false)

    await assert.rejects(
      client.setConfig({
        expectedRevision: 0,
        config: { ...initial.config, interval: 9 },
      }),
      (cause: unknown) => {
        assert.equal((cause as { kind?: unknown }).kind, 'conflict')
        assert.equal((cause as { state?: { config?: { revision?: unknown } } }).state?.config?.revision, 1)
        assert.equal(describeConfigUpdateFailure(cause).conflictState?.config.revision, 1)
        return true
      },
    )
  } finally {
    await client?.close()
    await server?.stop()
    await rm(root, { recursive: true, force: true })
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousConfigHome
    if (previousWebMode === undefined) delete process.env.TOKMON_WEB_MODE
    else process.env.TOKMON_WEB_MODE = previousWebMode
  }
})

test('reconciliation accepts the daemon acknowledgement and discards stale drafts', () => {
  const local = { ...DEFAULTS, revision: 6, privacyMode: false }
  const saved = { ...local, revision: 7 }
  const acknowledged = reconcileDaemonConfig(local, saved, { config: local, expectedRevision: 6 })
  assert.equal(acknowledged.pendingLocalConfig, null)
  assert.equal(acknowledged.conflict, false)
  assert.equal(acknowledged.config?.revision, 7)

  const remote = { ...DEFAULTS, revision: 8, privacyMode: true }
  const conflict = reconcileDaemonConfig(local, remote, { config: local, expectedRevision: 6 })
  assert.equal(conflict.pendingLocalConfig, null)
  assert.equal(conflict.conflict, true)
  assert.equal(conflict.config?.revision, 8)
})

test('a recovered settings stream clears an initial-load dead end without overwriting a dirty draft', () => {
  const remote = { ...DEFAULTS, revision: 2, privacyMode: false }
  const state = { protocol: { version: 3 as const, capabilities: ['config-cas', 'config-revision', 'allowed-hosts'] as const }, config: remote }
  const recovered = reconcileSettingsDraft(null, null, false, state)
  assert.equal(recovered.draft, remote)
  assert.equal(recovered.revision, 2)

  const draft = { ...DEFAULTS, revision: 1, privacyMode: true }
  const dirty = reconcileSettingsDraft(draft, 1, true, state)
  assert.equal(dirty.draft, draft)
  assert.equal(dirty.conflict, true)

  const stale = reconcileSettingsDraft(remote, 2, false, {
    ...state,
    config: { ...remote, revision: 1 },
  })
  assert.equal(stale.draft, remote)
  assert.equal(stale.revision, 2)
})
