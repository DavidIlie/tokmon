import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import test from 'node:test'
import { DEFAULTS } from '../config'
import { createDaemonRpcClient } from '../client/daemon-rpc-client'
import type { DataEngine } from './data-engine'
import type { WebSnapshot } from './contract'
import { mountWsRpc } from './ws'

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was not met before timeout')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function websocketUpgradeStatus(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let response = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('websocket upgrade timed out'))
    }, 1_000)
    socket.once('error', reject)
    socket.on('data', chunk => {
      response += chunk.toString('utf8')
      if (!response.includes('\r\n\r\n')) return
      clearTimeout(timer)
      socket.destroy()
      resolve(Number(response.match(/^HTTP\/1\.1 (\d{3})/)?.[1] ?? 0))
    })
    socket.once('connect', () => {
      socket.write([
        'GET /ws HTTP/1.1',
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '', '',
      ].join('\r\n'))
    })
  })
}

test('loopback dashboard websocket requires no browser token', async (t) => {
  const engine: DataEngine = {
    snapshot: () => null,
    start: () => {},
    subscribe: () => () => {},
    subscribeConfig: () => () => {},
    touch: () => {},
    refresh: async () => {},
    setConfig: () => {},
    broadcastConfig: () => {},
    stop: () => {},
  }
  const server = createServer()
  const closeRpc = await mountWsRpc(server, {
    engine,
    state: { config: { ...DEFAULTS } },
  })
  try {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('the sandbox disallows binding ephemeral loopback ports')
        return
      }
      throw cause
    }
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    assert.equal(await websocketUpgradeStatus(address.port), 101)
  } finally {
    await closeRpc()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('refresh RPC acknowledges only after the data engine pass completes', async (t) => {
  let release!: () => void
  const refreshGate = new Promise<void>(resolve => { release = resolve })
  let failRefresh = false
  const engine: DataEngine = {
    snapshot: () => null,
    start: () => {},
    subscribe: () => () => {},
    subscribeConfig: () => () => {},
    touch: () => {},
    refresh: () => failRefresh ? Promise.reject(new Error('provider refresh failed')) : refreshGate,
    setConfig: () => {},
    broadcastConfig: () => {},
    stop: () => {},
  }
  const server = createServer()
  const closeRpc = await mountWsRpc(server, { engine, state: { config: { ...DEFAULTS } } })
  let client: ReturnType<typeof createDaemonRpcClient> | null = null
  try {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('the sandbox disallows binding ephemeral loopback ports')
        return
      }
      throw cause
    }
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    // A dashboard served from loopback must be able to speak to its daemon
    // directly. Browser URLs are intentionally capability-free.
    client = createDaemonRpcClient(`http://127.0.0.1:${address.port}`, {
      transport: 'node',
      reconnectAttempts: 0,
    })

    let settled = false
    const pending = client.refresh('all').then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(settled, false)
    release()
    await pending
    assert.equal(settled, true)

    failRefresh = true
    await assert.rejects(client.refresh('all'), /provider refresh failed/)
  } finally {
    release()
    await client?.close()
    await closeRpc()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('a stale snapshot stream is restarted instead of remaining falsely live', async (t) => {
  const snapshot: WebSnapshot = {
    version: 'test',
    generatedAt: Date.now(),
    tz: 'UTC',
    intervalMs: 5,
    billingIntervalMs: 60_000,
    providers: [],
    accounts: [],
    seeded: false,
    peak: null,
  }
  let subscriptions = 0
  let configSubscriptions = 0
  const engine: DataEngine = {
    snapshot: () => snapshot,
    start: () => {},
    subscribe: (onSnapshot) => {
      subscriptions++
      onSnapshot({ ...snapshot, generatedAt: Date.now() })
      return () => {}
    },
    subscribeConfig: (onConfig) => {
      configSubscriptions++
      onConfig({ ...DEFAULTS })
      return () => {}
    },
    touch: () => {},
    refresh: async () => {},
    setConfig: () => {},
    broadcastConfig: () => {},
    stop: () => {},
  }
  const server = createServer()
  const closeRpc = await mountWsRpc(server, { engine, state: { config: { ...DEFAULTS } } })
  let client: ReturnType<typeof createDaemonRpcClient> | null = null
  let unsubscribe: (() => void) | null = null
  let unsubscribeConfig: (() => void) | null = null
  try {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('the sandbox disallows binding ephemeral loopback ports')
        return
      }
      throw cause
    }
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    client = createDaemonRpcClient(`http://127.0.0.1:${address.port}`, {
      transport: 'node',
      reconnectBaseDelayMs: 5,
      snapshotStaleFloorMs: 30,
    })
    let values = 0
    let configValues = 0
    unsubscribe = client.subscribeSnapshot(() => { values++ })
    unsubscribeConfig = client.subscribeConfig(() => { configValues++ })
    await waitFor(() =>
      subscriptions >= 2 && values >= 2
      && configSubscriptions >= 2 && configValues >= 2,
    )
  } finally {
    unsubscribe?.()
    unsubscribeConfig?.()
    await client?.close()
    await closeRpc()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
