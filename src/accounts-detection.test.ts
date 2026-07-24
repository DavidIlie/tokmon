import assert from 'node:assert/strict'
import test from 'node:test'
import { homedir } from 'node:os'
import { buildAccounts } from './accounts'
import {
  canonicalizeConfigHomeRefs,
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

test('a disabled manual account stays registered without being fetched or auto-recreated', () => {
  const disabled = { ...manual, homeDir: '~', enabled: false }
  const next = config({ accounts: [disabled] })
  const accounts = buildAccounts(next, ['claude'])

  assert.equal(accounts.some(account => account.homeDir === '~'), false)
  const row = getTrackedAccountRows(next, ['claude'], accounts)
    .find(candidate => candidate.id === manual.id)
  assert.deepEqual(
    row && { id: row.id, source: row.source, enabled: row.enabled },
    { id: manual.id, source: 'configured', enabled: false },
  )
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

test('snapshot-backed settings do not invent default accounts absent from daemon truth', () => {
  const rows = getTrackedAccountRows(config({}), undefined, [])
  assert.deepEqual(rows, [])
})

test('alternate auto account ids remain selected through config normalization', () => {
  const repaired = normalizeConfig({ ...DEFAULTS, activeAccountId: 'claude_other_stable' })
  assert.equal(repaired.activeAccountId, 'claude_other_stable')
})

test('a configured id collision disambiguates rather than dropping the detected account', () => {
  const accounts = buildAccounts(config({
    accounts: [{ ...manual, id: 'claude' }],
  }), ['claude'])
  assert.equal(accounts.find(account => account.id === 'claude')?.source, 'configured')
  assert.deepEqual(
    accounts.find(account => account.id === 'claude_auto'),
    {
      id: 'claude_auto',
      providerId: 'claude',
      name: 'Claude',
      color: 'green',
      homeDir: undefined,
      source: 'auto',
    },
  )
})

test('default-home spelling does not duplicate a configured account as removed', () => {
  const next = canonicalizeConfigHomeRefs(config({
    accounts: [{ ...manual, homeDir: homedir(), enabled: false }],
    accountDetection: {
      ...DEFAULTS.accountDetection,
      excludedAccounts: [{ providerId: 'claude', homeDir: '~' }],
    },
  }))
  const accounts = buildAccounts(next, [])
  const rows = getTrackedAccountRows(next, [], accounts)
  assert.equal(rows.some(row => row.source === 'ignored'), false)
  assert.equal(rows.filter(row => row.source === 'configured').length, 1)
  assert.equal(rows[0]?.enabled, false)
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
