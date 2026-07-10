import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { DEFAULTS } from '../config'
import { createDaemonRpcClient } from '../client/daemon-rpc-client'
import type { DataEngine } from './data-engine'
import { mountWsRpc } from './ws'

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
