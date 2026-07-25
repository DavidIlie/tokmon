import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULTS, type Config, type WebAccount, type WebSnapshot } from '@shared'
import { AccountsSection } from './accounts-section'

const account = (over: Partial<WebAccount> = {}): WebAccount => ({
  id: 'claude-1', providerId: 'claude', name: 'Claude Jane Doe', color: 'green', homeDir: '/home/jane/.claude',
  hasUsage: true, hasBilling: true, lastActivityAt: null, dashboard: null, table: null,
  billing: null, summaryState: 'ready', billingState: 'ready', tableState: 'ready',
  summaryUpdatedAt: null, billingUpdatedAt: null, tableUpdatedAt: null,
  // A display-name-only identity: redactEmail has nothing to substitute here.
  identity: { title: 'Claude Jane Doe', subtitle: null, accessibleLabel: 'Claude Jane Doe', redacted: false },
  ...over,
})

const snapshotOf = (accounts: WebAccount[]): WebSnapshot =>
  ({ accounts, installedProviders: ['claude'] }) as unknown as WebSnapshot

function render(draft: Config, accounts: WebAccount[]) {
  return renderToStaticMarkup(
    <AccountsSection
      draft={draft} patch={() => {}} snapshot={snapshotOf(accounts)}
      onEdit={() => {}} onConfigure={() => {}} onAdd={() => {}}
    />,
  )
}

test('a draft with privacy on hides an identity the snapshot still holds unredacted', () => {
  const draft: Config = { ...structuredClone(DEFAULTS), privacyMode: true }
  const html = render(draft, [account()])

  assert.doesNotMatch(html, /Claude Jane Doe/)
  assert.match(html, /Claude account 1/)
  // The path is hidden too, so the row discloses nothing about the home.
  assert.doesNotMatch(html, /home\/jane/)
})

test('privacy mode redacts the account name in every accessible label, not just the visible one', () => {
  const draft: Config = { ...structuredClone(DEFAULTS), privacyMode: true }
  const html = render(draft, [account(), account({ id: 'claude-2', name: 'jane@example.com', homeDir: '/home/jane/.claude-alt' })])

  assert.match(html, /aria-label="Set Claude account 1 active"/)
  assert.match(html, /aria-label="Remove Claude account 2 from Tokmon"/)
  assert.doesNotMatch(html, /aria-label="[^"]*Jane Doe/)
  assert.doesNotMatch(html, /aria-label="[^"]*@example\.com/)
})

test('privacy off still shows the registered identity on the row and its controls', () => {
  const draft: Config = { ...structuredClone(DEFAULTS), privacyMode: false }
  const html = render(draft, [account()])

  assert.match(html, /Claude Jane Doe/)
  assert.match(html, /aria-label="Set Claude Jane Doe active"/)
  assert.doesNotMatch(html, /Claude account 1/)
})
