import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseBrowserToken,
  shareableBrowserHash,
  shouldConnectBrowserAccess,
  shouldReloadForToken,
  verifyTokenAccess,
} from './rpc-client'

test('browser bootstrap reads an explicit fragment token before hash routing starts', () => {
  assert.deepEqual(parseBrowserToken('#tokmonToken=fragment-secret', '', null), {
    token: 'fragment-secret',
    explicit: true,
  })
  assert.deepEqual(parseBrowserToken('#/?tokmonToken=shareable-secret', '', null), {
    token: 'shareable-secret',
    explicit: true,
  })
  assert.deepEqual(parseBrowserToken(
    '#/analytics#tokmonToken=filtered-secret',
    '?period=30d',
    null,
  ), {
    token: 'filtered-secret',
    explicit: true,
  })
})

test('browser bootstrap preserves route hashes when falling back to the tab token', () => {
  assert.deepEqual(parseBrowserToken('#/overview', '', 'stored-secret'), {
    token: 'stored-secret',
    explicit: false,
  })
  assert.deepEqual(parseBrowserToken('#/tokmonToken=not-a-bootstrap-param', '', null), {
    token: undefined,
    explicit: false,
  })
})

test('query bootstrap remains supported for older launchers', () => {
  assert.deepEqual(parseBrowserToken('#/overview', '?tokmonToken=query-secret', null), {
    token: 'query-secret',
    explicit: true,
  })
})

test('empty and conflicting explicit capabilities fail closed instead of using storage', () => {
  assert.deepEqual(parseBrowserToken('#/#tokmonToken=', '', 'stored-secret'), {
    token: undefined,
    explicit: true,
  })
  assert.deepEqual(parseBrowserToken(
    '#/#tokmonToken=fragment-secret',
    '?tokmonToken=query-secret',
    'stored-secret',
  ), {
    token: undefined,
    explicit: true,
  })
})

test('shareable fragment keeps the capability after the hash-router path', () => {
  assert.equal(shareableBrowserHash('', 'copy-me'), '#/#tokmonToken=copy-me')
  assert.equal(
    shareableBrowserHash('#/analytics?range=30d', 'copy-me'),
    '#/analytics?range=30d#tokmonToken=copy-me',
  )
  assert.equal(
    shareableBrowserHash('#/models?tokmonToken=old&range=7d#section', 'new-token'),
    '#/models?range=7d#tokmonToken=new-token',
  )
  const encoded = shareableBrowserHash('#/overview', 'slash/value?')
  assert.equal(encoded, '#/overview#tokmonToken=slash%2Fvalue%3F')
  assert.equal(parseBrowserToken(encoded, '', null).token, 'slash/value?')
})

test('a fresh same-document capability reloads an unauthenticated or stale client', () => {
  assert.equal(shouldReloadForToken(undefined, { token: 'fresh', explicit: true }), true)
  assert.equal(shouldReloadForToken('stale', { token: 'fresh', explicit: true }), true)
  assert.equal(shouldReloadForToken('fresh', { token: 'fresh', explicit: true }), false)
  assert.equal(shouldReloadForToken('stored', { token: 'stored', explicit: false }), false)
  assert.equal(shouldReloadForToken('fresh', { token: undefined, explicit: true }), true)
})

test('health preflight classifies authorization before opening RPC', async () => {
  let requests = 0
  const response = (ok: boolean, body: unknown) => async () => {
    requests++
    return new Response(JSON.stringify(body), { status: ok ? 200 : 503 })
  }

  assert.equal(await verifyTokenAccess(undefined, response(true, { owner: true })), 'missing-token')
  assert.equal(requests, 0)
  assert.equal(await verifyTokenAccess('valid', response(true, { owner: true })), 'authorized')
  assert.equal(await verifyTokenAccess('stale', response(true, { owner: false })), 'expired-token')
  assert.equal(await verifyTokenAccess('bad-http', response(false, {})), 'unavailable')
  assert.equal(await verifyTokenAccess('bad-json', async () => new Response('{', { status: 200 })), 'unavailable')
  assert.equal(await verifyTokenAccess('offline', async () => { throw new Error('offline') }), 'unavailable')

  assert.equal(shouldConnectBrowserAccess('authorized'), true)
  assert.equal(shouldConnectBrowserAccess('missing-token'), false)
  assert.equal(shouldConnectBrowserAccess('expired-token'), false)
  assert.equal(shouldConnectBrowserAccess('unavailable'), false)
})
