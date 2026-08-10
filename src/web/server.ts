import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { type Config } from '../config'
import { TOKMON_CAPABILITIES, TOKMON_PROTOCOL_VERSION } from '../rpc/contract'
import { appVersion, send, sendJson, serveStatic, findWebRoot } from './static'
import { isDevMode, createViteDevServer, MISSING_BUILD_HTML, type ViteDevServerLike } from './vite-dev'
import { createDataEngine } from './data-engine'
import type { WebSnapshot } from './contract'
import { resolveEngineConfig } from './config-control'
import { mountWsRpc } from './ws'
import { isAllowedHostHeader, isSameOriginRequest } from './request-guard'
import {
  DAEMON_PORT_SPAN,
  daemonPortBase,
  resolveDaemonChannel,
  type DaemonChannel,
} from './daemon-channel'

const LOOPBACK_HOST = '127.0.0.1'
const NETWORK_HOST = '0.0.0.0'
export interface WebServerController {
  url: string
  port: number
  snapshot(): WebSnapshot | null
  config(): Config
  stop(): Promise<void>
}

export interface StartOptions {
  config: Config
  port?: number
  log?: boolean
  /** Explicit packaged dashboard directory. Electron cannot rely on import.meta.url discovery inside asar. */
  webRoot?: string
  /** Explicit host version for bundled embedders whose module URL is inside an asar. */
  version?: string
  /** Injected by the daemon so the lock can be published before web resources start. */
  wsToken?: string
  protocolVersion?: number
  capabilities?: readonly string[]
  ownerKind?: 'cli' | 'desktop'
  channel?: DaemonChannel
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false
  const actual = Buffer.from(given)
  const token = Buffer.from(expected)
  return actual.length === token.length && timingSafeEqual(actual, token)
}

/**
 * A dashboard tab stranded on a dead origin has to probe the other candidate
 * ports to find where the daemon moved, and a cross-port fetch is cross-origin.
 * Echo the origin for loopback callers only: a page on a real site sends its own
 * scheme/host here and gets no header, so it still cannot read this response —
 * exactly as before this existed. The Host guard above is untouched.
 */
function allowLoopbackOrigin(req: IncomingMessage, res: ServerResponse): void {
  const origin = header(req, 'origin')
  if (!origin) return
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:') return
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') return
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } catch {}
}

function guardHost(req: IncomingMessage, res: ServerResponse, config: Config): boolean {
  if (isAllowedHostHeader(header(req, 'host'), config.allowNetworkAccess, config.allowedHosts)) return true
  sendJson(res, 403, { error: 'forbidden' })
  return false
}

function guardSameOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (!isSameOriginRequest(req)) {
    sendJson(res, 403, { error: 'forbidden' })
    return false
  }
  return true
}

function createRouter(
  engine: ReturnType<typeof createDataEngine>,
  state: { config: Config },
  vite: ViteDevServerLike | null,
  webRoot: string | null,
  wsToken: string,
  version: string,
  protocolVersion: number,
  capabilities: readonly string[],
  ownerKind: 'cli' | 'desktop',
  channel: DaemonChannel,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = req.url || '/'
    const path = url.split('?')[0]
    const method = req.method || 'GET'

    // Check Host before every response, including static and Vite middleware. Binding
    // to loopback alone does not prevent DNS-rebinding requests from a hostile Host.
    if (!guardHost(req, res, state.config)) return

    if (path === '/api/data') {
      engine.touch()
      sendJson(res, 200, engine.snapshot() ?? { pending: true })
      return
    }

    if (path === '/healthz') {
      allowLoopbackOrigin(req, res)
      sendJson(res, 200, {
        ok: true,
        ready: engine.snapshot() !== null,
        version,
        protocolVersion,
        capabilities,
        ownerKind,
        channel,
        // Discovery requires this proof; public health checks retain their useful 200 response.
        owner: tokenMatches(header(req, 'x-tokmon-token'), wsToken),
      })
      return
    }

    if (path === '/api/config') {
      if (!guardSameOrigin(req, res)) return
      if (method === 'GET') {
        sendJson(res, 200, state.config)
        return
      }
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }

    if (vite) {
      vite.middlewares(req, res, () => { send(res, 404, 'text/plain', 'not found') })
      return
    }

    if (!webRoot) {
      send(res, 503, 'text/html; charset=utf-8', MISSING_BUILD_HTML)
      return
    }

    serveStatic(webRoot, url, res)
  }
}

export async function startWebServer(opts: StartOptions): Promise<WebServerController> {
  const state = { config: opts.config }
  const version = opts.version ?? appVersion()
  const protocolVersion = opts.protocolVersion ?? TOKMON_PROTOCOL_VERSION
  const capabilities = opts.capabilities ?? TOKMON_CAPABILITIES
  const ownerKind = opts.ownerKind ?? 'cli'
  const channel = resolveDaemonChannel(opts.channel)
  const wsToken = opts.wsToken ?? randomBytes(32).toString('base64url')
  const log = (msg: string) => { if (opts.log) process.stdout.write(msg + '\n') }

  const engineConfig = await resolveEngineConfig(state.config)

  const server = createServer()
  let vite: ViteDevServerLike | null = null
  let engine: ReturnType<typeof createDataEngine> | null = null
  let closeWsRpc: (() => Promise<void>) | null = null
  try {
    if (isDevMode()) vite = await createViteDevServer(server, log)
    const webRoot = vite ? null : (opts.webRoot ?? findWebRoot())
    if (!vite && !webRoot) log('  ⚠ no dashboard available — see the page for build/dev instructions')

    engine = createDataEngine({ version, config: state.config, ...engineConfig })
    server.addListener('request', createRouter(
      engine,
      state,
      vite,
      webRoot,
      wsToken,
      version,
      protocolVersion,
      capabilities,
      ownerKind,
      channel,
    ))
    closeWsRpc = await mountWsRpc(server, { engine, state })
    const bindHost = state.config.allowNetworkAccess ? NETWORK_HOST : LOOPBACK_HOST
    const port = await listenWithFallback(
      server,
      opts.port ?? daemonPortBase(channel),
      bindHost,
      DAEMON_PORT_SPAN,
    )
    const serverUrl = `http://${LOOPBACK_HOST}:${port}`

    if (vite?.warmupRequest) {
      try { await Promise.race([vite.warmupRequest('/src/main.tsx'), delay(5000)]) } catch {}
    }
    engine.start()

    let stopped = false
    return {
      url: serverUrl,
      port,
      snapshot: engine.snapshot,
      config: () => state.config,
      stop: async () => {
        if (stopped) return
        stopped = true
        engine?.stop()
        // The snapshot cache write is off-loop now, so it has to be settled
        // before the caller unlinks the lock and exits the process.
        await engine?.drainPersist?.().catch(() => {})
        await closeWsRpc?.().catch(() => {})
        server.closeAllConnections?.()
        await closeServer(server)
        try { await vite?.close() } catch {}
      },
    }
  } catch (error) {
    engine?.stop()
    await closeWsRpc?.().catch(() => {})
    server.closeAllConnections?.()
    await closeServer(server)
    try { await vite?.close() } catch {}
    throw error
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.() })
}

function closeServer(server: Server, timeoutMs = 1_000): Promise<void> {
  return new Promise(resolve => {
    const done = () => resolve()
    const timer = setTimeout(done, timeoutMs)
    timer.unref?.()
    try { server.close(() => { clearTimeout(timer); done() }) } catch { clearTimeout(timer); done() }
  })
}

function listenWithFallback(server: Server, startPort: number, host: string, span: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (startPort === 0) {
      const onError = (error: unknown) => reject(error)
      server.once('error', onError)
      server.listen(0, host, () => {
        server.off('error', onError)
        const addr = server.address()
        resolve(typeof addr === 'object' && addr ? addr.port : 0)
      })
      return
    }
    let port = startPort
    let tries = 1
    const attempt = () => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && tries < span) {
          tries++; port++; setImmediate(attempt)
        } else {
          reject(err)
        }
      }
      server.once('error', onError)
      // Drop the attempt's error handler once bound. Leaving it attached let a
      // later runtime error re-enter the ladder and call listen() on an already
      // listening server.
      server.listen(port, host, () => { server.off('error', onError); resolve(port) })
    }
    attempt()
  })
}
