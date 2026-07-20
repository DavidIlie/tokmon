import assert from 'node:assert/strict'
import test from 'node:test'
import { isDevMode } from './vite-dev'

test('test workers avoid implicit HMR while explicit web modes still win', () => {
  const previousContext = process.env.NODE_TEST_CONTEXT
  const previousMode = process.env.TOKMON_WEB_MODE
  try {
    process.env.NODE_TEST_CONTEXT = 'child-v8'
    delete process.env.TOKMON_WEB_MODE
    assert.equal(isDevMode(), false)
    process.env.TOKMON_WEB_MODE = 'dev'
    assert.equal(isDevMode(), true)
    process.env.TOKMON_WEB_MODE = 'prod'
    assert.equal(isDevMode(), false)
  } finally {
    if (previousContext === undefined) delete process.env.NODE_TEST_CONTEXT
    else process.env.NODE_TEST_CONTEXT = previousContext
    if (previousMode === undefined) delete process.env.TOKMON_WEB_MODE
    else process.env.TOKMON_WEB_MODE = previousMode
  }
})
