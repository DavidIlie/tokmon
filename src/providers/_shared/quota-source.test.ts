import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchQuotaSource } from './quota-source'

test('custom quota fetch authenticates once and rejects redirects', async () => {
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.TOKMON_TEST_PROXY_KEY
  process.env.TOKMON_TEST_PROXY_KEY = 'secret-value'
  let seen: { input: string; init?: RequestInit } | undefined
  globalThis.fetch = async (input, init) => {
    seen = { input: String(input), init }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await fetchQuotaSource(
      { url: 'https://proxy.example/api/oauth/usage', apiKeyEnv: 'TOKMON_TEST_PROXY_KEY' },
      { 'anthropic-beta': 'oauth-2025-04-20' },
    )
    assert.equal(result.ok, true)
    assert.equal(seen?.input, 'https://proxy.example/api/oauth/usage')
    assert.equal(new Headers(seen?.init?.headers).get('authorization'), 'Bearer secret-value')
    assert.equal(new Headers(seen?.init?.headers).get('anthropic-beta'), 'oauth-2025-04-20')
    assert.equal(seen?.init?.redirect, 'error')
    assert.ok(seen?.init?.signal instanceof AbortSignal)
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.TOKMON_TEST_PROXY_KEY
    else process.env.TOKMON_TEST_PROXY_KEY = originalSecret
  }
})

test('custom quota fetch does not make a request when its secret is missing', async () => {
  const originalFetch = globalThis.fetch
  delete process.env.TOKMON_TEST_MISSING_KEY
  globalThis.fetch = async () => assert.fail('fetch must not run without the configured secret')
  try {
    const result = await fetchQuotaSource({
      url: 'https://proxy.example/backend-api/wham/usage',
      apiKeyEnv: 'TOKMON_TEST_MISSING_KEY',
    })
    assert.deepEqual(result, { ok: false, error: 'API key environment variable TOKMON_TEST_MISSING_KEY is not set' })
  } finally {
    globalThis.fetch = originalFetch
  }
})
