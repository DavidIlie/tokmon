import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULTS, setProviderTrackingEnabled, type Config } from './config'

test('provider tracking preserves account, discovery, and presentation preferences', () => {
  const original: Config = {
    ...structuredClone(DEFAULTS),
    knownProviders: ['codex'],
    disabledProviders: ['claude', 'claude'],
    accounts: [{ id: 'claude-alt', providerId: 'claude', name: 'Alt', homeDir: '/tmp/claude' }],
    activeAccountId: 'claude-alt',
    accountDetection: {
      enabled: false,
      disabledProviders: ['claude'],
      excludedAccounts: [{ providerId: 'claude', homeDir: '/tmp/old-claude' }],
    },
    tray: { ...structuredClone(DEFAULTS.tray), pinnedProviders: ['claude', 'codex'] },
    desktop: { ...DEFAULTS.desktop, expandedProviders: ['claude'] },
  }

  const disabled = setProviderTrackingEnabled(original, 'claude', false)
  assert.deepEqual(disabled.disabledProviders, ['claude'])
  assert.deepEqual(disabled.knownProviders, ['codex', 'claude'])
  assert.equal(disabled.accounts, original.accounts)
  assert.equal(disabled.activeAccountId, original.activeAccountId)
  assert.equal(disabled.accountDetection, original.accountDetection)
  assert.equal(disabled.tray, original.tray)
  assert.equal(disabled.desktop, original.desktop)

  const restored = setProviderTrackingEnabled(disabled, 'claude', true)
  assert.deepEqual(restored.disabledProviders, [])
  assert.deepEqual(restored.knownProviders, ['codex', 'claude'])
  assert.deepEqual(restored.accounts, original.accounts)
  assert.equal(restored.activeAccountId, 'claude-alt')
  assert.deepEqual(restored.accountDetection, original.accountDetection)
  assert.deepEqual(restored.tray.pinnedProviders, ['claude', 'codex'])
  assert.deepEqual(restored.desktop.expandedProviders, ['claude'])
})
