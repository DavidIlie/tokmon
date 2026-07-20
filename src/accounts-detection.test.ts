import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAccounts } from './accounts'
import {
  DEFAULTS,
  getTrackedAccountRows,
  normalizeConfig,
  setDetectedAccountExcluded,
  type Config,
} from './config'

const manual = {
  id: 'manual-claude', providerId: 'claude' as const, name: 'Manual Claude',
  homeDir: '/tmp/manual-claude', color: 'green',
}

function config(overrides: Partial<Config>): Config {
  return {
    ...DEFAULTS,
    accounts: [],
    accountDetection: { ...DEFAULTS.accountDetection },
    ...overrides,
  }
}

test('global discovery off keeps explicit accounts and performs no automatic assembly', () => {
  const accounts = buildAccounts(config({
    accounts: [manual],
    accountDetection: { ...DEFAULTS.accountDetection, enabled: false },
  }), ['claude', 'codex'])
  assert.deepEqual(accounts.map(account => account.id), ['manual-claude'])
})

test('a provider detector can be disabled without disabling its manual accounts', () => {
  const accounts = buildAccounts(config({
    accounts: [manual],
    accountDetection: { ...DEFAULTS.accountDetection, disabledProviders: ['claude'] },
  }), ['claude'])
  assert.deepEqual(accounts.map(account => account.id), ['manual-claude'])
})

test('an excluded default account is not fetched but remains restorable in settings', () => {
  const next = config({
    accountDetection: {
      ...DEFAULTS.accountDetection,
      excludedAccounts: [{ providerId: 'claude', homeDir: '~' }],
    },
  })
  const accounts = buildAccounts(next, ['claude'])
  assert.equal(accounts.some(account => account.id === 'claude'), false)

  const rows = getTrackedAccountRows(next, ['claude'], accounts)
  const ignored = rows.find(row => row.source === 'ignored')
  assert.deepEqual(ignored?.excludedRef, { providerId: 'claude', homeDir: '~' })
})

test('detector exclusions toggle idempotently and malformed persisted policy repairs safely', () => {
  const excluded = setDetectedAccountExcluded(DEFAULTS.accountDetection, {
    providerId: 'codex', homeDir: ' /tmp/codex-old ',
  }, true)
  assert.deepEqual(excluded.excludedAccounts, [{ providerId: 'codex', homeDir: '/tmp/codex-old' }])
  assert.deepEqual(setDetectedAccountExcluded(excluded, {
    providerId: 'codex', homeDir: '/tmp/codex-old',
  }, true).excludedAccounts, excluded.excludedAccounts)
  assert.deepEqual(setDetectedAccountExcluded(excluded, {
    providerId: 'codex', homeDir: '/tmp/codex-old',
  }, false).excludedAccounts, [])

  const repaired = normalizeConfig({
    ...DEFAULTS,
    accountDetection: {
      enabled: false,
      disabledProviders: ['claude', 'claude', 'invalid'],
      excludedAccounts: [
        { providerId: 'codex', homeDir: ' /tmp/codex-old ' },
        { providerId: 'codex', homeDir: '/tmp/codex-old' },
        { providerId: 'invalid', homeDir: '/tmp/nope' },
      ],
    },
  })
  assert.deepEqual(repaired.accountDetection, {
    enabled: false,
    disabledProviders: ['claude'],
    excludedAccounts: [{ providerId: 'codex', homeDir: '/tmp/codex-old' }],
  })
})
