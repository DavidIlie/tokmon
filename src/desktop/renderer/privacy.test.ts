import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebAccount } from '../../web/contract'
import { accountIdentity, matchesPrivacyShortcut } from './privacy'

const account = (identity: string): WebAccount => ({
  id: 'claude-work', providerId: 'claude', name: identity, color: 'green', homeDir: null,
  hasUsage: true, hasBilling: true, email: identity, displayName: null, plan: 'Pro',
  lastActivityAt: null, dashboard: null, table: null, billing: null,
  summaryState: 'pending', billingState: 'pending', tableState: 'pending',
  summaryUpdatedAt: null, billingUpdatedAt: null, tableUpdatedAt: null,
})

test('privacy mode uses the shared global email redaction semantics', () => {
  assert.equal(accountIdentity(account('david@example.com'), true), '[redacted]')
})

test('email wins over a provider display name', () => {
  const value = account('david@example.com')
  value.displayName = 'Work'
  assert.equal(accountIdentity(value, true), '[redacted]')
})

test('a registered title never decorates a discovered email', () => {
  const value = account('Work')
  value.email = 'david@example.com'
  value.displayName = 'David'
  assert.equal(accountIdentity(value, false), 'david@example.com')
  assert.equal(accountIdentity(value, true), '[redacted]')
})

test('disabled privacy returns the exact identity', () => {
  assert.equal(accountIdentity(account('david@example.com'), false), 'david@example.com')
})

test('visible desktop identity ignores composite registered titles when email is available', () => {
  const value = account('Claude david@example.com')
  value.email = 'david@example.com'
  value.displayName = 'David'
  value.identity = {
    title: 'Claude david@example.com', subtitle: 'David',
    accessibleLabel: 'Claude david@example.com, David', redacted: false,
  }

  assert.equal(accountIdentity(value, false), 'david@example.com')
})

test('privacy mode keeps the daemon stable account ordinal instead of exposing email', () => {
  const value = account('Claude david@example.com')
  value.identity = {
    title: 'Claude account 2', subtitle: null,
    accessibleLabel: 'Claude account 2', redacted: true,
  }

  assert.equal(accountIdentity(value, true), 'Claude account 2')
})

test('privacy shortcut accepts configured P outside editable controls only', () => {
  assert.equal(matchesPrivacyShortcut({ key: 'p' }, 'p'), true)
  assert.equal(matchesPrivacyShortcut({ key: 'P' }, 'p'), true)
  assert.equal(matchesPrivacyShortcut({ key: 'p', editable: true }, 'p'), false)
  assert.equal(matchesPrivacyShortcut({ key: 'p', metaKey: true }, 'p'), false)
  assert.equal(matchesPrivacyShortcut({ key: 'P', shiftKey: true }, 'p'), false)
  assert.equal(matchesPrivacyShortcut({ key: 'p', repeat: true }, 'p'), false)
})
