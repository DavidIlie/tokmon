import assert from 'node:assert/strict'
import test from 'node:test'
import { tokenlessBrowserLocation } from './rpc-client'

test('legacy dashboard tokens are removed without disturbing routes or filters', () => {
  assert.equal(
    tokenlessBrowserLocation('/', '', '#/#tokmonToken=old-secret'),
    '/#/',
  )
  assert.equal(
    tokenlessBrowserLocation('/', '?period=30d&p=codex', '#/analytics#tokmonToken=old-secret'),
    '/?period=30d&p=codex#/analytics',
  )
  assert.equal(
    tokenlessBrowserLocation('/', '?tokmonToken=old-secret&period=7d', '#/models'),
    '/?period=7d#/models',
  )
  assert.equal(
    tokenlessBrowserLocation('/', '', '#/?tokmonToken=old-secret&range=30d'),
    '/#/?range=30d',
  )
  assert.equal(
    tokenlessBrowserLocation('/', '', '#/models#section=costs'),
    '/#/models#section=costs',
  )
})
