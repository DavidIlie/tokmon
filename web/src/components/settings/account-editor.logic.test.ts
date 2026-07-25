import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULTS, getTrackedAccountRows, type Config } from '@shared'
import { applyAccountSubmission, buildAccountFromDraft, newDraft, toDraft } from './account-editor.logic'

const autoRow = {
  id: 'claude_alt_1a2b3c', providerId: 'claude' as const,
  name: 'Claude alt', homeDir: '/home/jane/.claude-alt', color: 'green',
}

const configure = (cfg: Config) => newDraft(cfg, { ...autoRow, convertedFromId: autoRow.id })

function submit(cfg: Config, draft = configure(cfg)): Config {
  const result = buildAccountFromDraft(draft, cfg.accounts)
  assert.ok(result.ok, 'draft must be valid')
  return applyAccountSubmission(cfg, result)
}

test('converting the active detected account keeps it selected under its new id', () => {
  const cfg: Config = { ...structuredClone(DEFAULTS), activeAccountId: autoRow.id }

  const next = submit(cfg)

  const added = next.accounts.at(-1)!
  assert.notEqual(added.id, autoRow.id, 'conversion mints a fresh id')
  assert.equal(next.activeAccountId, added.id)
  // One row for that home, even while the snapshot still lists the auto account.
  assert.deepEqual(
    getTrackedAccountRows(next, ['claude'], [{ ...autoRow, source: 'auto' }])
      .filter(row => row.homeDir === autoRow.homeDir).map(row => row.source),
    ['configured'],
  )
})

test('the configure editor prefills the registered name, not a privacy placeholder', () => {
  const cfg: Config = { ...structuredClone(DEFAULTS), privacyMode: true }

  const draft = configure(cfg)

  assert.equal(draft.name, 'Claude alt')
  assert.equal(draft.homeDir, autoRow.homeDir)
  assert.equal(draft.convertedFromId, autoRow.id)
})

test('a non-converting add or edit leaves the active selection alone', () => {
  const cfg: Config = {
    ...structuredClone(DEFAULTS),
    accounts: [{ id: 'work', providerId: 'claude', name: 'Work', homeDir: '~', color: 'green', enabled: false }],
    activeAccountId: 'work',
  }

  const added = submit(cfg, newDraft(cfg, { providerId: 'claude', name: 'Second', homeDir: '/tmp/second' }))
  assert.equal(added.activeAccountId, 'work')

  const edited = submit(cfg, { ...toDraft(cfg.accounts[0]!), name: 'Renamed' })
  assert.equal(edited.activeAccountId, 'work')
  assert.equal(edited.accounts.length, 1)
  // The edit path preserves the disabled intent it does not own.
  assert.equal(edited.accounts[0]?.enabled, false)
})

test('an unset active selection is not captured by a conversion', () => {
  const cfg: Config = { ...structuredClone(DEFAULTS), activeAccountId: null }

  assert.equal(submit(cfg).activeAccountId, null)
})
