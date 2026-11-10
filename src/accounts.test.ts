import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { collectAccounts } from './accounts'
import { DEFAULTS, type Account as ConfigAccount, type Config } from './config-schema'
import { getTrackedAccountRows } from './tracked-accounts'
import { assembleSnapshot, type ResolvedAccount } from './web/data'
import { groupByProvider, snapshotUsageTotals } from './desktop/shared/presentation'
import type { DashboardData } from './types'

function withHome(run: (home: string) => void): void {
  const previous = process.env.HOME
  const home = mkdtempSync(path.join(tmpdir(), 'tokmon-accounts-'))
  process.env.HOME = home
  try {
    run(home)
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

function proxied(id: string, credentialId: string): ConfigAccount {
  return {
    id,
    providerId: 'claude',
    name: id,
    homeDir: '~',
    quotaSource: { kind: 'cliproxy', url: 'https://proxy.example', apiKeyEnv: 'CLIPROXY_API_KEY', credentialId },
  }
}

function config(overrides: Partial<Config>): Config {
  return { ...DEFAULTS, ...overrides, accountDetection: { ...DEFAULTS.accountDetection, ...overrides.accountDetection } }
}

const homeExcluded = { enabled: true, disabledProviders: [], excludedAccounts: [{ providerId: 'claude' as const, homeDir: '~' }] }

test('CLIProxy accounts get one usage-only local source even with the local account removed', () => {
  withHome(() => {
    const cfg = config({
      accounts: [proxied('pool_a', 'a.json'), proxied('pool_b', 'b.json')],
      accountDetection: homeExcluded,
    })
    const { accounts } = collectAccounts(cfg, ['claude'])
    const usage = accounts.filter(account => account.usageOnly)
    assert.deepEqual(usage.map(account => [account.id, account.homeDir, account.quotaSource]), [['claude_local_usage', undefined, undefined]])
    assert.equal(accounts.filter(account => account.quotaSource?.kind === 'cliproxy').length, 2)
    // Never a settings row the user could "remove" into a no-op exclusion.
    assert.equal(getTrackedAccountRows(cfg, undefined, accounts).some(row => row.id === 'claude_local_usage'), false)
  })
})

test('a tracked local account already reads the logs, so no usage source double counts them', () => {
  withHome(() => {
    const { accounts } = collectAccounts(config({ accounts: [proxied('pool_a', 'a.json')] }), ['claude'])
    assert.equal(accounts.some(account => account.usageOnly), false)
    assert.equal(accounts.filter(account => account.providerId === 'claude' && !account.quotaSource).length, 1)
  })
})

test('no usage source without local logs or when the local account was disabled', () => {
  withHome(() => {
    const cfg = config({ accounts: [proxied('pool_a', 'a.json')], accountDetection: homeExcluded })
    assert.equal(collectAccounts(cfg, []).accounts.some(account => account.usageOnly), false)
    const disabledLocal: ConfigAccount = { id: 'local', providerId: 'claude', name: 'Local', homeDir: '~', enabled: false }
    const withDisabled = config({ accounts: [disabledLocal, proxied('pool_a', 'a.json')] })
    assert.equal(collectAccounts(withDisabled, ['claude']).accounts.some(account => account.usageOnly), false)
  })
})

test('a configured default-home account no longer hides discovered alternate homes', () => {
  withHome(home => {
    const alt = path.join(home, '.claude_work')
    mkdirSync(path.join(alt, '.claude'), { recursive: true })
    writeFileSync(path.join(alt, '.claude', '.credentials.json'), '{}')
    const local: ConfigAccount = { id: 'local', providerId: 'claude', name: 'Local', homeDir: '~' }
    const { accounts } = collectAccounts(config({ accounts: [local] }), ['claude'])
    assert.ok(accounts.some(account => account.homeDir === alt), 'alternate home is still discovered')
  })
})

function dashboard(cost: number, lastActivityAt: number): DashboardData {
  const period = { cost, tokens: cost * 1000, input: cost * 100, cacheRead: 0, cacheSavings: 0 }
  return {
    today: period, week: period, month: period, burnRate: 0,
    series: [cost], lastActivityAt,
  } as unknown as DashboardData
}

test('usage-only spend reaches provider totals but never quota rows or headroom', () => {
  withHome(() => {
    const cfg = config({ accounts: [proxied('pool_a', 'a.json'), proxied('pool_b', 'b.json')], accountDetection: homeExcluded })
    const resolved: ResolvedAccount[] = collectAccounts(cfg, ['claude']).accounts.map(account => ({
      account,
      hasUsage: account.quotaSource?.kind !== 'cliproxy',
      hasBilling: !account.usageOnly,
      color: '#d97757',
    }))
    const now = Date.now()
    const snapshot = assembleSnapshot({
      version: 'test', tz: 'UTC', intervalMs: 2000, billingIntervalMs: 300_000, resolved, config: cfg,
      usage: new Map([['claude_local_usage', { dashboard: dashboard(12, now), table: null }]]),
      billing: new Map(),
    })
    const local = snapshot.accounts.find(account => account.id === 'claude_local_usage')
    assert.equal(local?.usageOnly, true)
    assert.equal(local?.hasBilling, false)
    assert.deepEqual(snapshot.providers[0]?.headroom?.activeAccountIds, [])

    const [group] = groupByProvider(snapshot)
    assert.deepEqual(group?.accounts.map(account => account.id), ['pool_a', 'pool_b'])
    assert.equal(group?.usageAccounts.length, 3)
    assert.equal(snapshotUsageTotals(snapshot)?.dashboard?.today.cost, 12)
  })
})
