import assert from 'node:assert/strict'
import test from 'node:test'
import type { Account } from '../providers'
import { deriveAccountIdentity } from '../usage-semantics'
import { derivePrivacyLabels, deriveSlots, findActiveSlot, resolveAccountTitle } from './app-layout.logic'

const account = (over: Partial<Account> = {}): Account => ({
  id: 'claude-1', providerId: 'claude', name: 'Claude Jane Doe', homeDir: '~', color: 'green', ...over,
})

/**
 * The F3 case: a Claude home whose label came from a display name, not an
 * email. redactEmail finds nothing to substitute, so before the shared
 * projection the TUI printed the person's real name while the daemon and the
 * desktop both printed a provider ordinal.
 */
const displayNameOnly = account()

test('privacy mode names an account by the same ordinal the daemon assigns', () => {
  const daemon = deriveAccountIdentity({
    name: 'Claude Jane Doe', email: null, providerName: 'Claude', ordinal: 1, privacyMode: true,
  })
  const labels = derivePrivacyLabels({
    privacyMode: true,
    rows: [displayNameOnly],
    resolved: [{ id: 'claude-1', providerId: 'claude', identity: daemon }],
  })

  assert.equal(daemon.title, 'Claude account 1')
  assert.equal(labels.get('claude-1'), 'Claude account 1')
  assert.deepEqual(deriveSlots([displayNameOnly], true, labels).map(slot => slot.name), ['Claude account 1'])
  // Without the projection the strip fell back to the raw display name.
  assert.deepEqual(deriveSlots([displayNameOnly], true).map(slot => slot.name), ['Claude Jane Doe'])
})

test('privacy mode never trusts an identity resolved before the toggle', () => {
  // The daemon bakes privacy into the snapshot, so a draft that just turned
  // privacy on is reading identities that were computed with it off.
  const stale = {
    title: 'Claude Jane Doe', subtitle: 'jane@example.com',
    accessibleLabel: 'Claude Jane Doe, jane@example.com', redacted: false,
  }
  const labels = derivePrivacyLabels({
    privacyMode: true,
    rows: [displayNameOnly],
    resolved: [{ id: 'claude-1', providerId: 'claude', identity: stale }],
  })

  assert.equal(labels.get('claude-1'), 'Claude account 1')
})

test('privacy ordinals follow snapshot order and survive extra settings rows', () => {
  const rows = [
    account({ id: 'claude-1' }),
    { id: 'ignored:codex:/old', providerId: 'codex' as const, name: 'Codex account' },
    account({ id: 'claude-2', name: 'jane@example.com' }),
    account({ id: 'codex-1', providerId: 'codex', name: 'Codex Jane' }),
  ]
  const labels = derivePrivacyLabels({
    privacyMode: true,
    rows,
    resolved: [
      { id: 'claude-1', providerId: 'claude' },
      { id: 'claude-2', providerId: 'claude' },
      { id: 'codex-1', providerId: 'codex' },
    ],
  })

  assert.equal(labels.get('claude-1'), 'Claude account 1')
  assert.equal(labels.get('claude-2'), 'Claude account 2')
  assert.equal(labels.get('codex-1'), 'Codex account 1')
  // A removed row has no resolved account, so it gets no invented ordinal —
  // borrowing one would name it identically to a live account.
  assert.equal(labels.get('ignored:codex:/old'), 'Codex account')
  assert.notEqual(labels.get('ignored:codex:/old'), labels.get('codex-1'))
})

test('privacy off leaves every label exactly as it was', () => {
  const accounts = [account({ id: 'claude-1' }), account({ id: 'claude-2', name: 'jane@example.com' })]
  const labels = derivePrivacyLabels({
    privacyMode: false,
    rows: accounts,
    resolved: accounts.map(a => ({ id: a.id, providerId: a.providerId })),
  })

  assert.equal(labels.size, 0)
  assert.deepEqual(
    deriveSlots(accounts, false, labels).map(slot => slot.name),
    ['All', 'Claude Jane Doe', 'jane@example.com'],
  )
})

test('slot selection is unaffected by relabelling', () => {
  const accounts = [account({ id: 'claude-1' }), account({ id: 'claude-2' })]
  const labels = derivePrivacyLabels({
    privacyMode: true,
    rows: accounts,
    resolved: accounts.map(a => ({ id: a.id, providerId: a.providerId })),
  })
  const slots = deriveSlots(accounts, true, labels)

  assert.deepEqual(findActiveSlot(slots, 'claude-2'), { activeSlotIdx: 2, focusId: 'claude-2' })
})

// The local privacy toggle is optimistic (useConfigState/app.tsx), so the
// snapshot in hand can still be the identity the daemon resolved while privacy
// was off. Every other surface re-projects; the dashboard card must too.
test('the dashboard card title matches the strip under a stale unredacted identity', () => {
  const stale = deriveAccountIdentity({
    name: 'Claude jane@example.com',
    email: 'jane@example.com',
    displayName: 'Jane Doe',
    providerName: 'Claude',
    ordinal: 1,
    privacyMode: false,
  })
  const accounts = [account({ id: 'claude-1', name: 'Claude jane@example.com' })]
  const resolved = [{ id: 'claude-1', providerId: 'claude' as const, identity: stale }]
  const labels = derivePrivacyLabels({ privacyMode: true, rows: accounts, resolved })

  const title = resolveAccountTitle({
    name: 'Claude jane@example.com',
    email: 'jane@example.com',
    identity: stale,
    providerName: 'Claude',
    privacyMode: true,
    privacyLabel: labels.get('claude-1'),
  })

  assert.equal(title, 'Claude account 1')
  assert.equal(title, deriveSlots(accounts, true, labels)[0]!.name)
  assert.doesNotMatch(title, /@/)
})

test('a display-name-only identity is still hidden, since redactEmail finds nothing to mask', () => {
  const stale = deriveAccountIdentity({
    name: 'Claude Jane Doe', displayName: 'Jane Doe',
    providerName: 'Claude', ordinal: 2, privacyMode: false,
  })
  const title = resolveAccountTitle({
    name: 'Claude Jane Doe', identity: stale, providerName: 'Claude',
    privacyMode: true, privacyLabel: 'Claude account 2',
  })

  assert.equal(title, 'Claude account 2')
})

test('privacy off keeps the daemon title-first identity byte for byte', () => {
  const identity = deriveAccountIdentity({
    name: 'Work', email: 'jane@example.com',
    providerName: 'Claude', ordinal: 1, privacyMode: false,
  })

  assert.equal(
    resolveAccountTitle({ name: 'Work', email: 'jane@example.com', identity, providerName: 'Claude', privacyMode: false }),
    'Work \u00b7 jane@example.com',
  )
  assert.equal(
    resolveAccountTitle({ name: 'Work', email: 'jane@example.com', providerName: 'Claude', privacyMode: false }),
    'Work jane@example.com',
  )
})
