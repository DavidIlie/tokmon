import {
  createDaemonRpcClient,
  type DaemonRpcClient,
  type RpcConnState,
} from '../../../src/client/daemon-rpc-client'

let client: DaemonRpcClient | null = null
export type BrowserRpcConnState = Exclude<RpcConnState, 'closed'>
const connListeners = new Set<(state: BrowserRpcConnState) => void>()

/**
 * Remove capability parameters emitted by older tokmon releases. The local
 * dashboard no longer authenticates browser tabs, so copied loopback URLs are
 * ordinary URLs again.
 */
export function tokenlessBrowserLocation(pathname: string, search: string, hash: string): string {
  const query = new URLSearchParams(search)
  query.delete('tokmonToken')

  let route = hash.replace(/^#/, '')
  if (!route.startsWith('/')) {
    const legacy = new URLSearchParams(route)
    route = legacy.has('tokmonToken') ? '/' : route
  } else {
    const nestedHash = route.indexOf('#')
    if (nestedHash !== -1) {
      const nested = new URLSearchParams(route.slice(nestedHash + 1))
      if (nested.has('tokmonToken')) {
        nested.delete('tokmonToken')
        route = `${route.slice(0, nestedHash)}${nested.size ? `#${nested.toString()}` : ''}`
      }
    }
    const queryStart = route.indexOf('?')
    if (queryStart !== -1) {
      const routeQuery = new URLSearchParams(route.slice(queryStart + 1))
      routeQuery.delete('tokmonToken')
      route = `${route.slice(0, queryStart)}${routeQuery.size ? `?${routeQuery.toString()}` : ''}`
    }
  }

  const nextSearch = query.size ? `?${query.toString()}` : ''
  const nextHash = route ? `#${route}` : ''
  return `${pathname}${nextSearch}${nextHash}`
}

if (typeof window !== 'undefined') {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const next = tokenlessBrowserLocation(
    window.location.pathname,
    window.location.search,
    window.location.hash,
  )
  if (next !== current) window.history.replaceState(window.history.state, '', next)
}

function emitConn(state: BrowserRpcConnState): void {
  for (const listener of connListeners) listener(state)
}

function handleRpcConn(state: RpcConnState): void {
  if (state !== 'closed') emitConn(state)
}

export function daemonRpcClient(): DaemonRpcClient {
  if (!client) {
    client = createDaemonRpcClient(window.location.origin, {
      transport: 'browser',
      onConn: handleRpcConn,
    })
  }
  return client
}

export function subscribeRpcConnection(listener: (state: BrowserRpcConnState) => void): () => void {
  connListeners.add(listener)
  return () => { connListeners.delete(listener) }
}
