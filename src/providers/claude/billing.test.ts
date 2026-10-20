import test from 'node:test'
import assert from 'node:assert/strict'
import { claudeBilling, sharedClaudeCredentialMatches } from './billing'

test('shared Claude credentials require a verified matching alternate account', () => {
  assert.equal(sharedClaudeCredentialMatches(undefined, { accountUuid: 'account-a', email: null }), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', undefined), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', null), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', { accountUuid: 'account-b', email: null }), false)
  assert.equal(sharedClaudeCredentialMatches('account-a', { accountUuid: 'account-a', email: null }), true)
})

test('Claude custom quota source reports a missing key without leaking endpoint data', async () => {
  delete process.env.TOKMON_MISSING_CLAUDE_KEY
  const result = await claudeBilling({
    id: 'proxy', providerId: 'claude', name: 'Proxy', color: 'green',
    quotaSource: {
      url: 'https://private.example/api/oauth/usage',
      apiKeyEnv: 'TOKMON_MISSING_CLAUDE_KEY',
    },
  })
  assert.equal(result.error, 'API key environment variable TOKMON_MISSING_CLAUDE_KEY is not set')
  assert.equal(result.error?.includes('private.example'), false)
})
