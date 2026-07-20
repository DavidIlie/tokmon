import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULTS, type Config, type ConfigState } from '@shared'
import { setAppearanceMode, togglePrivacyMode } from './config-client'

function state(revision: number, privacyMode: boolean, patch: Partial<Config> = {}): ConfigState {
  return {
    protocol: { version: 3, capabilities: [] },
    config: {
      ...DEFAULTS,
      ...patch,
      revision,
      privacyMode,
      tray: { ...DEFAULTS.tray, ...patch.tray },
      desktop: { ...DEFAULTS.desktop, ...patch.desktop },
    },
  }
}

test('privacy toggle writes immediately from the subscribed revision without fetching', async () => {
  const writes: Array<{ config: Config; expectedRevision: number }> = []
  const writer = {
    async setConfig(update: { config: Config; expectedRevision: number }): Promise<ConfigState> {
      writes.push(update)
      return state(5, true)
    },
  }

  const result = await togglePrivacyMode(state(4, false), writer)

  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.expectedRevision, 4)
  assert.equal(writes[0]?.config.privacyMode, true)
  assert.equal(result.config.revision, 5)
  assert.equal(result.config.privacyMode, true)
})

test('privacy conflict retries from daemon state while preserving the desired value', async () => {
  const writes: Array<{ config: Config; expectedRevision: number }> = []
  const latest = state(8, false, { allowNetworkAccess: true })
  const writer = {
    async setConfig(update: { config: Config; expectedRevision: number }): Promise<ConfigState> {
      writes.push(update)
      if (writes.length === 1) throw { kind: 'conflict', state: latest }
      return state(9, true, { allowNetworkAccess: update.config.allowNetworkAccess })
    },
  }

  const result = await togglePrivacyMode(state(7, false), writer)

  assert.equal(writes.length, 2)
  assert.equal(writes[1]?.expectedRevision, 8)
  assert.equal(writes[1]?.config.privacyMode, true)
  assert.equal(writes[1]?.config.allowNetworkAccess, true)
  assert.equal(result.config.revision, 9)
})

test('privacy conflict already at the desired state needs no duplicate write', async () => {
  let writes = 0
  const latest = state(12, true)
  const writer = {
    async setConfig(): Promise<ConfigState> {
      writes++
      throw { kind: 'conflict', state: latest }
    },
  }

  const result = await togglePrivacyMode(state(10, false), writer)

  assert.equal(writes, 1)
  assert.deepEqual(result.config, latest.config)
})

test('theme mode conflict rebases without overwriting concurrent settings', async () => {
  const writes: Array<{ config: Config; expectedRevision: number }> = []
  const latest = state(22, false, { interval: 9 })
  const writer = {
    async setConfig(update: { config: Config; expectedRevision: number }): Promise<ConfigState> {
      writes.push(update)
      if (writes.length === 1) throw { kind: 'conflict', state: latest }
      return state(23, false, { interval: update.config.interval, appearance: update.config.appearance })
    },
  }

  const result = await setAppearanceMode(state(20, false), 'dark', writer)

  assert.equal(writes.length, 2)
  assert.equal(writes[1]?.expectedRevision, 22)
  assert.equal(writes[1]?.config.interval, 9)
  assert.equal(writes[1]?.config.appearance.mode, 'dark')
  assert.equal(result.config.revision, 23)
})
