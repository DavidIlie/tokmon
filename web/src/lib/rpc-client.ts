import {
  createDaemonRpcClient,
  type DaemonRpcClient,
  type RpcConnState,
} from '../../../src/client/daemon-rpc-client'

let client: DaemonRpcClient | null = null
const connListeners = new Set<(state: Exclude<RpcConnState, 'closed'>) => void>()

function emitConn(state: RpcConnState): void {
  if (state === 'closed') return
  for (const listener of connListeners) listener(state)
}

export function daemonRpcClient(): DaemonRpcClient {
  if (!client) {
    client = createDaemonRpcClient(window.location.origin, {
      transport: 'browser',
      onConn: emitConn,
    })
  }
  return client
}

export function subscribeRpcConnection(listener: (state: Exclude<RpcConnState, 'closed'>) => void): () => void {
  connListeners.add(listener)
  return () => { connListeners.delete(listener) }
}
