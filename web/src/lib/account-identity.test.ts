import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebAccount } from '@shared'
import { accountIdentityText, scopedAccountIdentityText } from './account-identity'

const account = (overrides: Partial<WebAccount>): WebAccount => ({
  id: 'work', providerId: 'claude', name: 'Claude', color: '#fff', homeDir: null,
  hasUsage: true, hasBilling: true, lastActivityAt: null, dashboard: null, table: null,
  billing: null, summaryState: 'ready', billingState: 'ready', tableState: 'ready',
  summaryUpdatedAt: null, billingUpdatedAt: null, tableUpdatedAt: null,
  ...overrides,
})

test('account labels prefer the daemon identity and avoid repeating the provider', () => {
  const live = account({ identity: {
    title: 'Claude', subtitle: 'work@example.com', accessibleLabel: 'Claude, work@example.com', redacted: false,
  } })
  assert.equal(accountIdentityText(live, 'Claude'), 'work@example.com')
  assert.equal(scopedAccountIdentityText(live, 'Claude'), 'Claude · work@example.com')
})

test('account labels preserve daemon redaction and support older snapshots', () => {
  const privateAccount = account({ identity: {
    title: 'Claude account 1', subtitle: null, accessibleLabel: 'Claude account 1', redacted: true,
  } })
  assert.equal(accountIdentityText(privateAccount, 'Claude'), 'Claude account 1')
  assert.equal(accountIdentityText(account({ name: 'Work' }), 'Claude'), 'Work')
})
