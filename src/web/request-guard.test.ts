import assert from 'node:assert/strict'
import test from 'node:test'
import type { IncomingMessage } from 'node:http'
import { isAllowedHostHeader, isAllowedLocalRequest } from './request-guard'

const request = (host: string, origin?: string) => ({
  headers: { host, ...(origin ? { origin } : {}) },
}) as IncomingMessage

test('network request guard defaults to loopback only', () => {
  assert.equal(isAllowedHostHeader('127.0.0.1:4317', false), true)
  assert.equal(isAllowedHostHeader('localhost:4317', false), true)
  assert.equal(isAllowedHostHeader('[::1]:4317', false), true)
  assert.equal(isAllowedHostHeader('192.168.1.50:4317', false), false)
  assert.equal(isAllowedHostHeader('evil.example:4317', false), false)
})

test('explicit network access allows IP hosts but still requires same-origin browsers', () => {
  assert.equal(isAllowedHostHeader('192.168.1.50:4317', true), true)
  assert.equal(isAllowedHostHeader('evil.example:4317', true), false)
  assert.equal(isAllowedLocalRequest(request('192.168.1.50:4317', 'http://192.168.1.50:4317'), true), true)
  assert.equal(isAllowedLocalRequest(request('192.168.1.50:4317', 'https://evil.example'), true), false)
  assert.equal(isAllowedLocalRequest(request('127.0.0.1:4317', 'https://evil.example'), false), false)
})

test('explicit network access allows configured DNS hosts only', () => {
  const allowedHosts = ['tokmon.electron.code.example']

  assert.equal(isAllowedHostHeader('tokmon.electron.code.example', true, allowedHosts), true)
  assert.equal(isAllowedHostHeader('TOKMON.ELECTRON.CODE.EXAMPLE:443', true, allowedHosts), true)
  assert.equal(isAllowedHostHeader('tokmon.electron.code.example.evil.test', true, allowedHosts), false)
  assert.equal(isAllowedHostHeader('tokmon.electron.code.example', false, allowedHosts), false)
  assert.equal(
    isAllowedLocalRequest(
      request('tokmon.electron.code.example', 'https://tokmon.electron.code.example'),
      true,
      allowedHosts,
    ),
    true,
  )
})
