import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBrowserToken } from './rpc-client'

test('browser bootstrap reads an explicit fragment token before hash routing starts', () => {
  assert.deepEqual(parseBrowserToken('#tokmonToken=fragment-secret', '', null), {
    token: 'fragment-secret',
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
