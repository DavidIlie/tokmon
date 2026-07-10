import test from 'node:test'
import assert from 'node:assert/strict'
import { sharedClaudeCredentialMatches } from './billing'

test('shared Claude credentials require a verified matching alternate account', () => {
  assert.equal(sharedClaudeCredentialMatches(undefined, { accountUuid: 'account-a', email: null }), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', undefined), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', null), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', { accountUuid: 'account-b', email: null }), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', { accountUuid: 'account-a', email: null }), true)
})
