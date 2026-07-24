import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardDeepLink } from './dashboard-deep-link'

test('dashboard deep links keep static serving at root and use hash routing', () => {
  assert.equal(
    dashboardDeepLink('http://127.0.0.1:7890/', '/settings/accounts'),
    'http://127.0.0.1:7890/#/settings/accounts',
  )
  assert.equal(
    dashboardDeepLink('http://127.0.0.1:7890/', '/'),
    'http://127.0.0.1:7890/#/overview',
  )
})
