import {
  createDaemonRpcClient,
  type DaemonRpcClient,
  type RpcConnState,
} from '../../../src/client/daemon-rpc-client'

let client: DaemonRpcClient | null = null
const connListeners = new Set<(state: Exclude<RpcConnState, 'closed'>) => void>()
const TOKEN_STORAGE_KEY = 'tokmon.daemonToken'

function browserToken(): string | undefined {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  let stored: string | null = null
  try { stored = window.sessionStorage.getItem(TOKEN_STORAGE_KEY) } catch {}
  const token = fragment.get('tokmonToken') ?? query.get('tokmonToken') ?? stored ?? undefined

  // Keep the capability per-tab so reload/HMR can reconnect, but remove it from
  // the visible URL. sessionStorage is origin-scoped and dies with the tab.
  if (token) {
    try { window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token) } catch {}
    fragment.delete('tokmonToken')
    query.delete('tokmonToken')
    const search = query.size ? `?${query.toString()}` : ''
    const hash = fragment.size ? `#${fragment.toString()}` : ''
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${hash}`)
  }
  return token
}

function emitConn(state: RpcConnState): void {
  if (state === 'closed') return
  for (const listener of connListeners) listener(state)
}

export function daemonRpcClient(): DaemonRpcClient {
  if (!client) {
    client = createDaemonRpcClient(window.location.origin, {
      transport: 'browser',
      wsToken: browserToken(),
      onConn: emitConn,
    })
  }
  return client
}

export function subscribeRpcConnection(listener: (state: Exclude<RpcConnState, 'closed'>) => void): () => void {
  connListeners.add(listener)
  return () => { connListeners.delete(listener) }
}
