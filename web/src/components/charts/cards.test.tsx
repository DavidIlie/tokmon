import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WebAccount } from '@shared'
import { ProviderCard } from './cards'

const account = (over: Partial<WebAccount> = {}): WebAccount => ({
  id: 'claude-1', providerId: 'claude', name: 'Claude jane@example.com', color: 'green',
  homeDir: '/home/jane/.claude', hasUsage: true, hasBilling: true, lastActivityAt: null,
  dashboard: null, table: null, billing: null,
  summaryState: 'ready', billingState: 'ready', tableState: 'ready',
  summaryUpdatedAt: null, billingUpdatedAt: null, tableUpdatedAt: null,
  // The identity the daemon resolved while privacy mode was still off. The web
  // toggle is optimistic (requestPrivacyToggle sets local state before the
  // round-trip), so a privacy-on render can be holding exactly this.
  identity: {
    title: 'Claude jane@example.com', subtitle: 'Jane Doe',
    accessibleLabel: 'Claude jane@example.com, Jane Doe', redacted: false,
  },
  ...over,
})

const render = (acc: WebAccount, privacyMode: boolean, ordinal: number | null = null) =>
  renderToStaticMarkup(
    <ProviderCard
      account={acc} index={0} preset="tokmon" providerName="Claude"
      privacyMode={privacyMode} ordinal={ordinal} resetDisplay="relative" tz="UTC"
    />,
  )

test('privacy mode hides an identity the snapshot still holds unredacted', () => {
  const html = render(account(), true, 1)

  assert.doesNotMatch(html, /jane@example\.com/)
  assert.doesNotMatch(html, /Jane Doe/)
  assert.match(html, /Claude account 1/)
})

test('the ordinal is the snapshot position, not this card list index', () => {
  // Filtered down to one card, but it is the provider's second account.
  const html = render(account({ id: 'claude-2' }), true, 2)

  assert.match(html, /Claude account 2/)
})

test('an account with no known ordinal is named without borrowing one', () => {
  const html = render(account(), true, null)

  assert.doesNotMatch(html, /jane@example\.com/)
  assert.match(html, /Claude account(?!\s*\d)/)
})

test('a redacted identity is shown exactly as the daemon resolved it', () => {
  const html = render(account({
    identity: { title: 'Claude account 3', subtitle: null, accessibleLabel: 'Claude account 3', redacted: true },
  }), true, 1)

  assert.match(html, /Claude account 3/)
})

test('privacy off still shows the daemon title-first identity', () => {
  const html = render(account(), false, 1)

  assert.match(html, /Claude jane@example\.com · Jane Doe/)
})
