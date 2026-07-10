import {
  createDaemonRpcClient,
  type DaemonRpcClient,
  type RpcConnState,
} from '../../../src/client/daemon-rpc-client'

let client: DaemonRpcClient | null = null
const connListeners = new Set<(state: Exclude<RpcConnState, 'closed'>) => void>()
const TOKEN_STORAGE_KEY = 'tokmon.daemonToken'

export function parseBrowserToken(
  hash: string,
  search: string,
  stored: string | null,
): { token: string | undefined; explicit: boolean } {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  const query = new URLSearchParams(search)
  const explicitToken = fragment.get('tokmonToken') || query.get('tokmonToken') || undefined
  return {
    token: explicitToken ?? stored ?? undefined,
    explicit: explicitToken !== undefined,
  }
}

function browserToken(): string | undefined {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  let stored: string | null = null
  try { stored = window.sessionStorage.getItem(TOKEN_STORAGE_KEY) } catch {}
  const fragmentToken = fragment.get('tokmonToken') || undefined
  const queryToken = query.get('tokmonToken') || undefined
  const { token, explicit } = parseBrowserToken(window.location.hash, window.location.search, stored)

  // Keep the capability per-tab so reload/HMR can reconnect, but remove it from
  // the visible URL. sessionStorage is origin-scoped and dies with the tab.
  if (token && explicit) {
    try { window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token) } catch {}
    if (fragmentToken) fragment.delete('tokmonToken')
    if (queryToken) query.delete('tokmonToken')
    const search = query.size ? `?${query.toString()}` : ''
    const hash = fragmentToken
      ? (fragment.size ? `#${fragment.toString()}` : '')
      : window.location.hash
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${hash}`)
  }
  return token
}

// Capture the fragment capability during module evaluation. App imports run
// before createHashHistory() initializes and rewrites an unrecognized hash.
const bootstrapToken = typeof window === 'undefined' ? undefined : browserToken()

function emitConn(state: RpcConnState): void {
  if (state === 'closed') return
  for (const listener of connListeners) listener(state)
}

export function daemonRpcClient(): DaemonRpcClient {
  if (!client) {
    client = createDaemonRpcClient(window.location.origin, {
      transport: 'browser',
      wsToken: bootstrapToken ?? browserToken(),
      onConn: emitConn,
    })
  }
  return client
}

export function subscribeRpcConnection(listener: (state: Exclude<RpcConnState, 'closed'>) => void): () => void {
  connListeners.add(listener)
  return () => { connListeners.delete(listener) }
}
