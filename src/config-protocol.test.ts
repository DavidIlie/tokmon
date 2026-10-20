import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Schema } from 'effect'
import {
  DEFAULTS,
  DEFAULT_TRAY_CONFIG,
  loadConfig,
  normalizeConfig,
  saveConfig,
  type Config,
} from './config'
import {
  ConfigSchema,
  ConfigStateSchema,
  TOKMON_PROTOCOL_VERSION,
} from './rpc/contract'
import {
  applyConfigUpdate,
  ConfigConflictError,
  ConfigPersistenceError,
} from './web/config-control'

test('the RPC config schema rejects malformed config documents', () => {
  assert.throws(() => Schema.decodeUnknownSync(ConfigSchema)({ ...DEFAULTS, interval: 'fast' }))
  assert.throws(() => Schema.decodeUnknownSync(ConfigSchema)({
    ...DEFAULTS,
    accounts: [{ id: 'a', name: 'A', homeDir: '~', providerId: 'not-a-provider' }],
  }))
  assert.throws(() => Schema.decodeUnknownSync(ConfigSchema)({
    ...DEFAULTS,
    tray: { ...DEFAULT_TRAY_CONFIG, activeTimeoutMin: 'recently' },
  }))
})

test('custom quota sources accept only the provider endpoint on a safe URL', () => {
  const claude = normalizeConfig({
    ...DEFAULTS,
    accounts: [{
      id: 'proxy-claude', providerId: 'claude', name: 'Proxy Claude', homeDir: '~',
      quotaSource: { url: 'https://cliproxy.example/api/oauth/usage', apiKeyEnv: 'CLIPROXY_KEY' },
    }],
  })
  assert.deepEqual(claude.accounts[0]?.quotaSource, {
    url: 'https://cliproxy.example/api/oauth/usage', apiKeyEnv: 'CLIPROXY_KEY',
  })

  const codex = normalizeConfig({
    ...DEFAULTS,
    accounts: [{
      id: 'proxy-codex', providerId: 'codex', name: 'Proxy Codex', homeDir: '~',
      quotaSource: { url: 'http://127.0.0.1:8317/backend-api/wham/usage', apiKeyEnv: 'CLIPROXY_KEY_2' },
    }],
  })
  assert.equal(codex.accounts[0]?.quotaSource?.url, 'http://127.0.0.1:8317/backend-api/wham/usage')

  for (const url of [
    'http://cliproxy.example/api/oauth/usage',
    'https://user:pass@cliproxy.example/api/oauth/usage',
    'https://cliproxy.example/api/oauth/usage?leak=1',
    'https://cliproxy.example/api/oauth/usage#fragment',
    'https://cliproxy.example/wrong',
  ]) {
    const repaired = normalizeConfig({
      ...DEFAULTS,
      accounts: [{
        id: 'unsafe', providerId: 'claude', name: 'Unsafe', homeDir: '~',
        quotaSource: { url, apiKeyEnv: 'CLIPROXY_KEY' },
      }],
    })
    assert.equal(repaired.accounts[0]?.quotaSource, undefined, url)
  }
})

test('custom quota sources reject unsafe environment variable names and unsupported providers', () => {
  for (const account of [
    {
      id: 'bad-env', providerId: 'claude', name: 'Bad env', homeDir: '~',
      quotaSource: { url: 'https://cliproxy.example/api/oauth/usage', apiKeyEnv: 'KEY=value' },
    },
    {
      id: 'cursor', providerId: 'cursor', name: 'Cursor', homeDir: '~',
      quotaSource: { url: 'https://cliproxy.example/api/oauth/usage', apiKeyEnv: 'CLIPROXY_KEY' },
    },
  ]) {
    const repaired = normalizeConfig({ ...DEFAULTS, accounts: [account] })
    assert.equal(repaired.accounts[0]?.quotaSource, undefined)
  }
})

test('the RPC config state rejects incompatible protocol versions', () => {
  assert.throws(() => Schema.decodeUnknownSync(ConfigStateSchema)({
    protocol: { version: 2, capabilities: ['config-cas', 'config-revision'] },
    config: DEFAULTS,
  }))
  assert.doesNotThrow(() => Schema.decodeUnknownSync(ConfigStateSchema)({
    protocol: { version: TOKMON_PROTOCOL_VERSION, capabilities: ['config-cas', 'config-revision', 'allowed-hosts', 'future-addition'] },
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

test('an old full-document CAS update preserves every capability-gated config field', async () => {
  const previous = process.env.XDG_CONFIG_HOME
  const root = await mkdtemp(join(tmpdir(), 'tokmon-config-old-client-'))
  const currentAppearance = {
    ...DEFAULTS.appearance,
    mode: 'dark' as const,
    preset: 'custom' as const,
    custom: {
      base: 'tokmon' as const,
      light: {},
      dark: { accent: '#00ff77' },
    },
  }
  const currentPins = ['claude', 'codex']
  const currentExpanded = ['claude']
  const currentDetection: Config['accountDetection'] = {
    enabled: true,
    disabledProviders: ['codex'],
    excludedAccounts: [{ providerId: 'claude' as const, homeDir: '/tmp/old-claude' }],
  }
  const currentMenuBar: Config['tray']['menuBar'] = {
    ...DEFAULTS.tray.menuBar,
    mode: 'custom',
    elements: { providerMark: false, value: true, progress: true },
    density: 'compact',
  }
  const state: { config: Config } = {
    config: {
      ...DEFAULTS,
      accounts: [{
        id: 'disabled-manual',
        providerId: 'claude',
        name: 'Disabled manual',
        homeDir: '/tmp/disabled-manual',
        enabled: false,
        quotaSource: { url: 'https://proxy.example/api/oauth/usage', apiKeyEnv: 'CLIPROXY_KEY' },
      }],
      appearance: currentAppearance,
      tray: {
        ...DEFAULTS.tray,
        menuBar: currentMenuBar,
        pinnedProviders: currentPins,
        menuBarValue: 'todayTokens',
      },
      desktop: { ...DEFAULTS.desktop, expandedProviders: currentExpanded, graphRangeDays: 30 },
      accountDetection: currentDetection,
    },
  }
  const broadcasts: Config[] = []
  const engine = {
    setConfig: () => assert.fail('appearance must be a hot update'),
    broadcastConfig: (config: Config) => { broadcasts.push(config) },
  } as never
  const {
    appearance: _unsupportedAppearance,
    accountDetection: _unsupportedDetection,
    desktop: _unsupportedDesktop,
    ...oldClientTopLevel
  } = state.config
  const {
    menuBar: _unsupportedMenuBar,
    pinnedProviders: _unsupportedProviderPins,
    menuBarValue: _unsupportedMenuBarValue,
    ...oldClientTray
  } = oldClientTopLevel.tray
  const oldClientConfig = {
    ...oldClientTopLevel,
    accounts: oldClientTopLevel.accounts.map(({ enabled: _unsupportedEnabled, quotaSource: _unsupportedQuotaSource, ...account }) => account),
    tray: oldClientTray,
  }

  try {
    process.env.XDG_CONFIG_HOME = root
    const saved = await applyConfigUpdate(engine, state, {
      expectedRevision: 0,
      config: { ...oldClientConfig, privacyMode: false } as unknown as Config,
    })
    assert.equal(saved.config.revision, 1)
    assert.equal(saved.config.privacyMode, false)
    assert.deepEqual(saved.config.appearance, currentAppearance)
    assert.deepEqual(saved.config.tray.pinnedProviders, currentPins)
    assert.deepEqual(saved.config.tray.menuBar, currentMenuBar)
    assert.equal(saved.config.tray.menuBarValue, 'todayTokens')
    assert.deepEqual(saved.config.desktop.expandedProviders, currentExpanded)
    assert.equal(saved.config.desktop.graphRangeDays, 30)
    assert.deepEqual(saved.config.accountDetection, currentDetection)
    assert.equal(saved.config.accounts[0]?.enabled, false)
    assert.deepEqual(saved.config.accounts[0]?.quotaSource, state.config.accounts[0]?.quotaSource)
    assert.deepEqual(broadcasts[0]?.appearance, currentAppearance)
    assert.deepEqual(broadcasts[0]?.tray.pinnedProviders, currentPins)
    assert.deepEqual(broadcasts[0]?.tray.menuBar, currentMenuBar)
    assert.equal(broadcasts[0]?.tray.menuBarValue, 'todayTokens')
    assert.deepEqual(broadcasts[0]?.desktop.expandedProviders, currentExpanded)
    assert.deepEqual(broadcasts[0]?.accountDetection, currentDetection)
    const persisted = await loadConfig()
    assert.deepEqual(persisted.appearance, currentAppearance)
    assert.deepEqual(persisted.tray.pinnedProviders, currentPins)
    assert.deepEqual(persisted.tray.menuBar, currentMenuBar)
    assert.equal(persisted.tray.menuBarValue, 'todayTokens')
    assert.deepEqual(persisted.desktop.expandedProviders, currentExpanded)
    assert.equal(persisted.desktop.graphRangeDays, 30)
    assert.deepEqual(persisted.accountDetection, currentDetection)
    assert.equal(persisted.accounts[0]?.enabled, false)
    assert.deepEqual(persisted.accounts[0]?.quotaSource, state.config.accounts[0]?.quotaSource)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
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
