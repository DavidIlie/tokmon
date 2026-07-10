import {
  createDaemonRpcClient,
  type DaemonRpcClient,
  type RpcConnState,
} from '../../../src/client/daemon-rpc-client'

let client: DaemonRpcClient | null = null
export type BrowserRpcConnState = Exclude<RpcConnState, 'closed'> | 'auth-required' | 'unavailable'
const connListeners = new Set<(state: BrowserRpcConnState) => void>()
const TOKEN_STORAGE_KEY = 'tokmon.daemonToken'

function fragmentTokenParams(hash: string): URLSearchParams {
  const fragment = hash.replace(/^#/, '')
  if (!fragment.startsWith('/')) {
    return new URLSearchParams(fragment)
  }
  const nestedHash = fragment.indexOf('#')
  if (nestedHash !== -1) {
    return new URLSearchParams(fragment.slice(nestedHash + 1))
  }
  // Compatibility for the unshipped route-search candidate and hand-built URLs.
  const queryStart = fragment.indexOf('?')
  return new URLSearchParams(queryStart === -1 ? '' : fragment.slice(queryStart + 1))
}

export function shareableBrowserHash(hash: string, token: string): string {
  let route = hash.startsWith('#/') ? hash.slice(1) : '/'
  const nestedHash = route.indexOf('#')
  if (nestedHash !== -1) route = route.slice(0, nestedHash)

  // Remove the route-search token used by pre-release builds while preserving
  // any unrelated route search parameters.
  const queryStart = route.indexOf('?')
  if (queryStart !== -1) {
    const params = new URLSearchParams(route.slice(queryStart + 1))
    params.delete('tokmonToken')
    route = `${route.slice(0, queryStart)}${params.size ? `?${params.toString()}` : ''}`
  }
  return `#${route}#tokmonToken=${encodeURIComponent(token)}`
}

export function parseBrowserToken(
  hash: string,
  search: string,
  stored: string | null,
): { token: string | undefined; explicit: boolean } {
  const fragment = fragmentTokenParams(hash)
  const query = new URLSearchParams(search)
  const explicit = fragment.has('tokmonToken') || query.has('tokmonToken')
  const candidates = [
    ...fragment.getAll('tokmonToken'),
    ...query.getAll('tokmonToken'),
  ].filter(Boolean)
  const explicitToken = new Set(candidates).size <= 1 ? candidates[0] : undefined
  return {
    token: explicit ? explicitToken : stored ?? undefined,
    explicit,
  }
}

function browserToken(): string | undefined {
  const query = new URLSearchParams(window.location.search)
  let stored: string | null = null
  try { stored = window.sessionStorage.getItem(TOKEN_STORAGE_KEY) } catch {}
  const queryToken = query.get('tokmonToken') || undefined
  const { token, explicit } = parseBrowserToken(window.location.hash, window.location.search, stored)

  // Keep a tab-local copy for reload/HMR. Fragment capabilities stay in the
  // visible URL so users can copy W's URL into another browser; fragments are
  // never sent in HTTP requests or Referer headers.
  if (token) {
    if (explicit) {
      try { window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token) } catch {}
    }
    const canonical = window.location.hash.startsWith('#/')
      && window.location.hash.includes('#tokmonToken=')
    if (queryToken) query.delete('tokmonToken')
    if (!canonical || queryToken) {
      const search = query.size ? `?${query.toString()}` : ''
      const hash = canonical ? window.location.hash : shareableBrowserHash(window.location.hash, token)
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${hash}`)
    }
  }
  return token
}

// Capture legacy token-only fragments during module evaluation, before
// createHashHistory() can rewrite an unrecognized hash. New W URLs are already
// valid hash-router locations and remain copyable.
const bootstrapToken = typeof window === 'undefined' ? undefined : browserToken()

export function shouldReloadForToken(
  activeToken: string | undefined,
  next: { token: string | undefined; explicit: boolean },
): boolean {
  return next.explicit && next.token !== activeToken
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const next = parseBrowserToken(window.location.hash, window.location.search, null)
    if (!shouldReloadForToken(bootstrapToken, next)) return
    browserToken()
    window.location.reload()
  })
}

export type BrowserAccess = 'authorized' | 'missing-token' | 'expired-token' | 'unavailable'

function activeBrowserToken(): string | undefined {
  return bootstrapToken ?? browserToken()
}

export async function verifyTokenAccess(
  token: string | undefined,
  request: typeof fetch = fetch,
): Promise<BrowserAccess> {
  if (!token) return 'missing-token'
  try {
    const response = await request('/healthz', {
      headers: { 'x-tokmon-token': token },
      cache: 'no-store',
    })
    if (!response.ok) return 'unavailable'
    const health = await response.json() as { owner?: unknown }
    return health.owner === true ? 'authorized' : 'expired-token'
  } catch {
    return 'unavailable'
  }
}

export function shouldConnectBrowserAccess(access: BrowserAccess): boolean {
  return access === 'authorized'
}

export function verifyBrowserAccess(): Promise<BrowserAccess> {
  return verifyTokenAccess(activeBrowserToken())
}

function emitConn(state: BrowserRpcConnState): void {
  for (const listener of connListeners) listener(state)
}

let reconnectValidation: Promise<void> | null = null
let reconnectValidationTimer: ReturnType<typeof setTimeout> | null = null

function scheduleReconnectValidation(): void {
  if (reconnectValidationTimer) return
  reconnectValidationTimer = setTimeout(() => {
    reconnectValidationTimer = null
    validateReconnect()
  }, 2_500)
}

function validateReconnect(): void {
  if (reconnectValidation) return
  reconnectValidation = verifyBrowserAccess().then(async access => {
    if (access === 'authorized') return
    if (access === 'unavailable') {
      emitConn('unavailable')
      scheduleReconnectValidation()
      return
    }
    const stale = client
    client = null
    if (stale) await stale.close().catch(() => {})
    emitConn('auth-required')
  }).finally(() => { reconnectValidation = null })
}

function handleRpcConn(state: RpcConnState): void {
  if (state === 'closed') return
  if (state === 'live' && reconnectValidationTimer) {
    clearTimeout(reconnectValidationTimer)
    reconnectValidationTimer = null
  }
  emitConn(state)
  if (state === 'reconnecting' || state === 'error') validateReconnect()
}

export function daemonRpcClient(): DaemonRpcClient {
  if (!client) {
    client = createDaemonRpcClient(window.location.origin, {
      transport: 'browser',
      wsToken: activeBrowserToken(),
      onConn: handleRpcConn,
    })
  }
  return client
}

export function subscribeRpcConnection(listener: (state: BrowserRpcConnState) => void): () => void {
  connListeners.add(listener)
  return () => { connListeners.delete(listener) }
}
