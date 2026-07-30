import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { listenOrSkip } from '../test-helpers'
import { createDaemonRpcClient } from './daemon-rpc-client'

async function unusedLoopbackUrl(t: test.TestContext): Promise<string | null> {
  const server = createServer()
  if (!await listenOrSkip(t, server)) return null
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return `http://127.0.0.1:${address.port}`
}

test('a unary call to a dead daemon settles within its request timeout', async (t) => {
  const url = await unusedLoopbackUrl(t)
  if (!url) return
  const client = createDaemonRpcClient(url, {
    transport: 'node',
    reconnectAttempts: 0,
    requestTimeoutMs: 75,
  })
  try {
    const outcome = await Promise.race([
      client.getConfig().then(() => 'resolved', () => 'rejected'),
      new Promise<'test-timeout'>(resolve => setTimeout(() => resolve('test-timeout'), 750)),
    ])
    assert.equal(outcome, 'rejected')
  } finally {
    await client.close()
  }
})

test('close finalizes subscription watchdog and reconnect timers', async (t) => {
  const url = await unusedLoopbackUrl(t)
  if (!url) return

  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const timeouts = new Set<unknown>()
  const intervals = new Set<unknown>()

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const timer = originalSetTimeout(handler, timeout, ...args)
    timeouts.add(timer)
    return timer
  }) as typeof setTimeout
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    timeouts.delete(timer)
    return originalClearTimeout(timer)
  }) as typeof clearTimeout
  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const timer = originalSetInterval(handler, timeout, ...args)
    intervals.add(timer)
    return timer
  }) as typeof setInterval
  globalThis.clearInterval = ((timer: ReturnType<typeof setInterval>) => {
    intervals.delete(timer)
    return originalClearInterval(timer)
  }) as typeof clearInterval

  try {
    const client = createDaemonRpcClient(url, {
      transport: 'node',
      reconnectAttempts: 2,
      reconnectBaseDelayMs: 10,
      requestTimeoutMs: 75,
      snapshotStaleFloorMs: 20,
    })
    client.subscribeSnapshot(() => {})
    await client.close()
    assert.equal(intervals.size, 0)
    assert.equal(timeouts.size, 0)
  } finally {
    for (const timer of timeouts) originalClearTimeout(timer as ReturnType<typeof setTimeout>)
    for (const timer of intervals) originalClearInterval(timer as ReturnType<typeof setInterval>)
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  }
})
