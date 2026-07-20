import assert from 'node:assert/strict'
import test from 'node:test'
import { parseQueryArgs, queryHelp, runQueryCommand } from './cli-command'
import { DEFAULTS, PROVIDER_IDS, type Config } from './config'
import type { ConfigState, ConfigUpdateRequest } from './rpc/contract'
import type { WebSnapshot } from './web/contract'

const state = (config: Config): ConfigState => ({
  protocol: { version: 3, capabilities: [] },
  config,
})

function configHarness(initial: Config = structuredClone(DEFAULTS)) {
  let current = structuredClone(initial)
  let closed = 0
  let gets = 0
  const updates: ConfigUpdateRequest[] = []
  const connectConfig = async () => ({
    async getConfig() { gets++; return state(structuredClone(current)) },
    async setConfig(update: ConfigUpdateRequest) {
      updates.push(structuredClone(update))
      assert.equal(update.expectedRevision, current.revision)
      current = { ...structuredClone(update.config), revision: current.revision + 1 }
      return state(structuredClone(current))
    },
    async close() { closed++ },
  })
  return {
    connectConfig,
    current: () => current,
    closed: () => closed,
    gets: () => gets,
    updates,
  }
}

test('query argument parser accepts agent filters and rejects ambiguous refresh modes', () => {
  assert.deepEqual(
    parseQueryArgs(['--period=week', '--provider', 'codex', '--model', 'terra', '--json', '--timeout', '12']),
    {
      help: false,
      json: true,
      compact: false,
      refresh: false,
      cached: false,
      timeoutMs: 12_000,
      period: 'week',
      provider: 'codex',
      model: 'terra',
      positionals: [],
    },
  )
  assert.throws(() => parseQueryArgs(['--provider', 'unknown']), /unknown provider/)
  assert.throws(() => parseQueryArgs(['--refresh', '--cached']), /cannot be used together/)
})

test('every query command has focused help without starting the daemon', async () => {
  assert.match(queryHelp('usage'), /tokmon usage --model opus --json/)
  assert.match(queryHelp('providers'), /local data\/config locations/)
  assert.match(queryHelp('snapshot'), /complete raw snapshot/)
  assert.match(await runQueryCommand('config', ['--json', '--compact']), /^\{"path":".+config\.json"\}\n$/)
  assert.match(queryHelp('config'), /summary-mode <smart\|tightest>/)
})

test('config path remains daemon-free and backward compatible', async () => {
  let connected = false
  const dependencies = {
    configPath: () => '/tmp/tokmon-config.json',
    connectConfig: async () => {
      connected = true
      throw new Error('must not connect')
    },
  }
  assert.equal(await runQueryCommand('config', [], dependencies), '/tmp/tokmon-config.json\n')
  assert.equal(
    await runQueryCommand('config', ['path', '--json', '--compact'], dependencies),
    '{"path":"/tmp/tokmon-config.json"}\n',
  )
  assert.equal(connected, false)
})

test('config get reports daemon-owned app preferences and closes its client', async () => {
  const harness = configHarness({
    ...structuredClone(DEFAULTS),
    revision: 7,
    privacyMode: false,
    privacyToggleKey: 'x',
    tray: {
      ...DEFAULTS.tray,
      pinnedProviders: ['claude', 'codex'],
      showMenuBarText: false,
      displayMetric: 'tightestRemaining',
      activeTimeoutMin: 22,
      launchAtLogin: true,
    },
    desktop: { ...DEFAULTS.desktop, expandedProviders: ['cursor'] },
  })
  const compact = JSON.parse(await runQueryCommand('config', ['get', '--json', '--compact'], harness))
  assert.deepEqual(compact, {
    revision: 7,
    privacy: 'off',
    privacyKey: 'x',
    menuBarPins: ['claude', 'codex'],
    menuBarText: 'off',
    summaryMode: 'tightest',
    expandedProviders: ['cursor'],
    activeWindowMinutes: 22,
    graphRangeDays: 14,
    autoDetect: 'on',
    autoDetectProviders: [...PROVIDER_IDS],
    launchAtLogin: 'on',
  })
  assert.equal(harness.gets(), 1)
  assert.equal(harness.closed(), 1)

  const humanHarness = configHarness()
  const human = await runQueryCommand('config', ['get'], humanHarness)
  assert.match(human, /^privacy\s+on$/m)
  assert.match(human, /^menu-bar-pins\s+none$/m)
  assert.match(human, /^summary-mode\s+smart$/m)
})

test('config set supports every desktop preference through daemon CAS', async () => {
  const harness = configHarness()
  const run = (setting: string, value: string) =>
    runQueryCommand('config', ['set', setting, value], harness)

  assert.equal(await run('privacy', 'off'), 'privacy off\n')
  assert.equal(await run('privacy-key', 'v'), 'privacy-key v\n')
  assert.equal(await run('menu-bar-pins', 'claude,codex'), 'menu-bar-pins claude,codex\n')
  assert.equal(await run('menu-bar-text', 'off'), 'menu-bar-text off\n')
  assert.equal(await run('summary-mode', 'tightest'), 'summary-mode tightest\n')
  assert.equal(await run('expanded-providers', 'claude,cursor,codex'), 'expanded-providers claude,cursor,codex\n')
  assert.equal(await run('active-window', '17'), 'active-window 17\n')
  assert.equal(await run('graph-range', '30'), 'graph-range 30\n')
  assert.equal(await run('auto-detect', 'off'), 'auto-detect off\n')
  assert.equal(await run('auto-detect-providers', 'claude,codex'), 'auto-detect-providers claude,codex\n')
  const result = JSON.parse(await runQueryCommand(
    'config',
    ['set', 'launch-at-login', 'on', '--json', '--compact'],
    harness,
  ))
  assert.deepEqual(result, { setting: 'launch-at-login', value: 'on', revision: 11 })

  const config = harness.current()
  assert.equal(config.privacyMode, false)
  assert.equal(config.privacyToggleKey, 'v')
  assert.deepEqual(config.tray.pinnedProviders, ['claude', 'codex'])
  assert.deepEqual(config.tray.pins, [])
  assert.equal(config.tray.pinnedAccount, null)
  assert.equal(config.tray.showMenuBarText, false)
  assert.equal(config.tray.displayMetric, 'tightestRemaining')
  assert.deepEqual(config.desktop.expandedProviders, ['claude', 'cursor', 'codex'])
  assert.equal(config.tray.activeTimeoutMin, 17)
  assert.equal(config.desktop.graphRangeDays, 30)
  assert.equal(config.accountDetection.enabled, false)
  assert.deepEqual(config.accountDetection.disabledProviders, PROVIDER_IDS.filter(id => id !== 'claude' && id !== 'codex'))
  assert.equal(config.tray.launchAtLogin, true)
  assert.equal(harness.closed(), 11)
})

test('config set validates values before connecting', async () => {
  let connects = 0
  const dependencies = {
    connectConfig: async () => {
      connects++
      throw new Error('must not connect')
    },
  }
  await assert.rejects(runQueryCommand('config', ['set', 'privacy', 'yes'], dependencies), /must be on or off/)
  await assert.rejects(runQueryCommand('config', ['set', 'privacy-key', 'pp'], dependencies), /one printable/)
  await assert.rejects(runQueryCommand('config', ['set', 'menu-bar-pins', 'claude,codex,cursor'], dependencies), /at most 2/)
  await assert.rejects(runQueryCommand('config', ['set', 'menu-bar-pins', 'claude,wat'], dependencies), /unknown provider: wat/)
  await assert.rejects(runQueryCommand('config', ['set', 'expanded-providers', 'claude,,codex'], dependencies), /comma-separated/)
  await assert.rejects(runQueryCommand('config', ['set', 'summary-mode', 'average'], dependencies), /smart or tightest/)
  await assert.rejects(runQueryCommand('config', ['set', 'active-window', '0'], dependencies), /1 to 1440/)
  await assert.rejects(runQueryCommand('config', ['set', 'graph-range', '21'], dependencies), /7, 14, or 30/)
  await assert.rejects(runQueryCommand('config', ['set', 'auto-detect', 'maybe'], dependencies), /must be on or off/)
  await assert.rejects(runQueryCommand('config', ['set', 'auto-detect-providers', 'claude,wat'], dependencies), /unknown provider: wat/)
  await assert.rejects(runQueryCommand('config', ['set', 'unknown', 'on'], dependencies), /usage: tokmon config set/)
  assert.equal(connects, 0)
})

test('config set retries one conflict from fresh daemon state without losing remote fields', async () => {
  const initial = { ...structuredClone(DEFAULTS), revision: 2 }
  const remote = {
    ...structuredClone(DEFAULTS),
    revision: 3,
    tray: { ...DEFAULTS.tray, pinnedProviders: ['codex'] },
  }
  let current = initial
  let gets = 0
  let sets = 0
  let closes = 0
  const output = await runQueryCommand('config', ['set', 'privacy', 'off'], {
    connectConfig: async () => ({
      async getConfig() {
        gets++
        if (gets === 2) current = remote
        return state(structuredClone(current))
      },
      async setConfig(update) {
        sets++
        if (sets === 1) throw { kind: 'conflict', state: state(remote) }
        assert.equal(update.expectedRevision, 3)
        assert.equal(update.config.privacyMode, false)
        assert.deepEqual(update.config.tray.pinnedProviders, ['codex'])
        current = { ...structuredClone(update.config), revision: 4 }
        return state(current)
      },
      async close() { closes++ },
    }),
  })
  assert.equal(output, 'privacy off\n')
  assert.equal(gets, 2)
  assert.equal(sets, 2)
  assert.equal(closes, 1)
})

test('config set stops after one conflict retry and always closes', async () => {
  let sets = 0
  let closes = 0
  await assert.rejects(runQueryCommand('config', ['set', 'privacy', 'off'], {
    connectConfig: async () => ({
      async getConfig() { return state(structuredClone(DEFAULTS)) },
      async setConfig() { sets++; throw { kind: 'conflict', state: state(DEFAULTS) } },
      async close() { closes++ },
    }),
  }), cause => (cause as { kind?: unknown }).kind === 'conflict')
  assert.equal(sets, 2)
  assert.equal(closes, 1)
})

test('usage command emits a stable JSON envelope through an injected snapshot seam', async () => {
  const snapshot: WebSnapshot = {
    version: 'test', generatedAt: Date.UTC(2026, 6, 10), tz: 'UTC',
    intervalMs: 8_000, billingIntervalMs: 300_000, providers: [], accounts: [],
    seeded: false, peak: null,
  }
  let refresh: string | null = null
  const output = await runQueryCommand('usage', ['--json', '--compact', '--cached'], {
    fetchSnapshot: async (_timeout, requestedRefresh) => { refresh = requestedRefresh; return snapshot },
    configPath: () => '/tmp/tokmon-config.json',
  })
  const parsed = JSON.parse(output)
  assert.equal(refresh, null)
  assert.equal(parsed.schemaVersion, 1)
  assert.equal(parsed.tokmonConfig, '/tmp/tokmon-config.json')
  assert.deepEqual(parsed.filters, { provider: null, account: null, model: null })
  assert.deepEqual(parsed.models, [])
})
