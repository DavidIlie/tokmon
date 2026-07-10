import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeBase64UrlJson, identityFromIdToken } from './jwt'

test('JWT identity requires a three-part token and object payload', () => {
  const payload = Buffer.from(JSON.stringify({ email: 'a@example.com', name: 'A' })).toString('base64url')
  assert.deepEqual(identityFromIdToken(`header.${payload}`), {})
  assert.deepEqual(identityFromIdToken(`header.${payload}.signature`), {
    email: 'a@example.com',
    displayName: 'A',
    payload: { email: 'a@example.com', name: 'A' },
  })
  assert.equal(decodeBase64UrlJson('%%%'), null)
})
