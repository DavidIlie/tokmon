import assert from 'node:assert/strict'
import { createServer } from 'node:http'
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
  const token = 'w'.repeat(43)
  const closeRpc = await mountWsRpc(server, { engine, state: { config: { ...DEFAULTS } }, wsToken: token })
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
    client = createDaemonRpcClient(`http://127.0.0.1:${address.port}`, { transport: 'node', wsToken: token })

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
  const token = 's'.repeat(43)
  const closeRpc = await mountWsRpc(server, { engine, state: { config: { ...DEFAULTS } }, wsToken: token })
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
      wsToken: token,
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
