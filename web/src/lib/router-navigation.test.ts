import assert from 'node:assert/strict'
import test from 'node:test'
import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

function fakeWindow() {
  let state: Record<string, unknown> = {}
  const history = {
    get state() { return state },
    length: 1,
    pushState(next: Record<string, unknown>) { state = next },
    replaceState(next: Record<string, unknown>) { state = next },
    back() {},
    forward() {},
    go() {},
  }
  return {
    location: {
      pathname: '/',
      search: '?period=30d&p=codex',
      hash: '#/analytics',
    },
    history,
    addEventListener() {},
    removeEventListener() {},
  }
}

test('TanStack hash navigation preserves outer filters with ordinary local routes', () => {
  const history = createHashHistory({ window: fakeWindow() })
  assert.equal(history.location.pathname, '/analytics')
  assert.equal(history.location.search, '?period=30d&p=codex')
  assert.equal(history.location.hash, '')

  const root = createRootRoute()
  const models = createRoute({ getParentRoute: () => root, path: '/models' })
  const router = createRouter({ routeTree: root.addChildren([models]), history })
  const destination = router.buildLocation({ to: '/models' })

  assert.equal(destination.href, '/models')
  assert.equal(
    history.createHref(destination.href),
    '/?period=30d&p=codex#/models',
  )
  history.destroy()
})
