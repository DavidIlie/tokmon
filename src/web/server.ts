import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { type Config } from '../config'
import { resolveAccounts, tzFor } from './data'
import { appVersion, send, sendJson, serveStatic, findWebRoot } from './static'
import { isDevMode, createViteDevServer, MISSING_BUILD_HTML, type ViteDevServerLike } from './vite-dev'
import { createDataEngine } from './data-engine'
import type { WebSnapshot } from './contract'
import { billingIntervalFor, summaryIntervalFor } from './config-control'
import { mountWsRpc } from './ws'

// SECURITY: web server must only be reachable from localhost.
const HOST = '127.0.0.1'

const DEFAULT_PORT = 4317
const MAX_PORT_TRIES = 20
export interface WebServerController {
  url: string
  port: number
  wsToken: string
  snapshot(): WebSnapshot | null
  config(): Config
  stop(): Promise<void>
}

export interface StartOptions {
  config: Config
  port?: number
  log?: boolean
}

// ── Security for retained debug/control GET routes ───────────────────────────
// /api/data stays lenient for quick local inspection. /api/config remains
// guarded by loopback Origin/Host + X-Tokmon-Client. WS-RPC owns mutation,
// refresh, filesystem browsing, snapshots, and config streams.
function isLoopbackHostHeader(value: string | undefined): boolean {
  if (!value) return false
  // Strip an optional :port; accept 127.0.0.1, ::1, localhost.
  let host = value.trim().toLowerCase()
  if (host.startsWith('[')) host = host.slice(1, host.indexOf(']') === -1 ? host.length : host.indexOf(']'))
  else host = host.split(':')[0]
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  // A missing Origin is allowed (non-browser node clients don't send one).
  if (!origin || origin === 'null') return true
  try {
    const u = new URL(origin)
    return isLoopbackHostHeader(u.host)
  } catch {
    return false
  }
}

function guardPrivileged(req: IncomingMessage, res: ServerResponse): boolean {
  const header = (n: string) => {
    const v = req.headers[n]
    return Array.isArray(v) ? v[0] : v
  }
  if (req.headers['x-tokmon-client'] !== '1') {
    sendJson(res, 403, { error: 'forbidden' })
    return false
  }
  if (!isLoopbackHostHeader(header('host')) || !isLoopbackOrigin(header('origin'))) {
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
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = req.url || '/'
    const path = url.split('?')[0]
    const method = req.method || 'GET'

    // ── Lenient public routes (SPA) ──
    if (path === '/api/data') {
      engine.touch()
      sendJson(res, 200, engine.snapshot() ?? { pending: true })
      return
    }

    if (path === '/healthz') {
      sendJson(res, 200, { ok: true, ready: engine.snapshot() !== null })
      return
    }

    if (path === '/api/config') {
      if (!guardPrivileged(req, res)) return
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
  const tz = tzFor(state.config)
  const version = appVersion()
  const summaryIntervalMs = summaryIntervalFor(state.config)
  const billingIntervalMs = billingIntervalFor(state.config)
  const wsToken = randomBytes(32).toString('base64url')
  const log = (msg: string) => { if (opts.log) process.stdout.write(msg + '\n') }

  const resolved = await resolveAccounts(state.config)

  const server = createServer()
  let vite: ViteDevServerLike | null = null
  if (isDevMode()) vite = await createViteDevServer(server, log)
  const webRoot = vite ? null : findWebRoot()

  if (!vite && !webRoot) log('  ⚠ no dashboard available — see the page for build/dev instructions')

  const engine = createDataEngine({ version, config: state.config, tz, summaryIntervalMs, billingIntervalMs, resolved })
  server.addListener('request', createRouter(engine, state, vite, webRoot))
  const closeWsRpc = await mountWsRpc(server, { engine, state, wsToken })

  const port = await listenWithFallback(server, opts.port ?? DEFAULT_PORT)
  const serverUrl = `http://${HOST}:${port}`

  if (vite?.warmupRequest) {
    try { await Promise.race([vite.warmupRequest('/src/main.tsx'), delay(5000)]) } catch {}
  }

  engine.start()

  return {
    url: serverUrl,
    port,
    wsToken,
    snapshot: engine.snapshot,
    config: () => state.config,
    stop: async () => {
      engine.stop()
      await closeWsRpc().catch(() => {})
      const closeHttp = () => new Promise<void>(resolve => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
      if (vite) {
        try { await vite.close() } catch {}
      }
      await closeHttp()
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.() })
}

function listenWithFallback(server: Server, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    // Port 0 = ask the kernel for a free ephemeral port (the TUI's private
    // daemon). Bind directly and read the assigned port back from address();
    // no EADDRINUSE walk applies.
    if (startPort === 0) {
      server.once('error', reject)
      server.listen(0, HOST, () => {
        const addr = server.address()
        resolve(typeof addr === 'object' && addr ? addr.port : 0)
      })
      return
    }
    let port = startPort
    let tries = 0
    const attempt = () => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && tries < MAX_PORT_TRIES) {
          tries++; port++; setImmediate(attempt)
        } else {
          reject(err)
        }
      })
      server.listen(port, HOST, () => resolve(port))
    }
    attempt()
  })
}
