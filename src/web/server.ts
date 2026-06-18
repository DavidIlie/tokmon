import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import type { Config } from '../config'
import { resolveAccounts, tzFor } from './data'
import { appVersion, send, sendJson, serveStatic, findWebRoot } from './static'
import { isDevMode, createViteDevServer, MISSING_BUILD_HTML, type ViteDevServerLike } from './vite-dev'
import { createDataEngine } from './data-engine'
import type { WebSnapshot } from './contract'

// SECURITY: web server must only be reachable from localhost.
const HOST = '127.0.0.1'

const DEFAULT_PORT = 4317
const MAX_PORT_TRIES = 20
const MIN_SUMMARY_INTERVAL_MS = 8000
const BILLING_INTERVAL_FALLBACK_MIN = 5

export interface WebServerController {
  url: string
  port: number
  snapshot(): WebSnapshot | null
  stop(): Promise<void>
}

export interface StartOptions {
  config: Config
  port?: number
  log?: boolean
}

function createRouter(
  engine: ReturnType<typeof createDataEngine>,
  vite: ViteDevServerLike | null,
  webRoot: string | null,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = req.url || '/'
    const path = url.split('?')[0]

    if (path === '/api/data') {
      engine.touch()
      sendJson(res, 200, engine.snapshot() ?? { pending: true })
      return
    }

    if (path === '/healthz') {
      sendJson(res, 200, { ok: true, ready: engine.snapshot() !== null })
      return
    }

    if (path === '/api/stream') {
      const cleanup = engine.addSseClient(res)
      req.on('close', cleanup)
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
  const { config } = opts
  const tz = tzFor(config)
  const version = appVersion()
  const summaryIntervalMs = Math.max(MIN_SUMMARY_INTERVAL_MS, (config.interval || 2) * 1000)
  const billingIntervalMs = Math.max(1, config.billingInterval || BILLING_INTERVAL_FALLBACK_MIN) * 60_000
  const log = (msg: string) => { if (opts.log) process.stdout.write(msg + '\n') }

  const resolved = await resolveAccounts(config)

  const server = createServer()
  let vite: ViteDevServerLike | null = null
  if (isDevMode()) vite = await createViteDevServer(server, log)
  const webRoot = vite ? null : findWebRoot()

  if (!vite && !webRoot) log('  ⚠ no dashboard available — see the page for build/dev instructions')

  const engine = createDataEngine({ version, tz, summaryIntervalMs, billingIntervalMs, resolved })
  server.addListener('request', createRouter(engine, vite, webRoot))

  const port = await listenWithFallback(server, opts.port ?? DEFAULT_PORT)
  const serverUrl = `http://${HOST}:${port}`

  if (vite?.warmupRequest) {
    try { await Promise.race([vite.warmupRequest('/src/main.tsx'), delay(5000)]) } catch { /* best-effort */ }
  }

  engine.start()

  return {
    url: serverUrl,
    port,
    snapshot: engine.snapshot,
    stop: () => new Promise<void>(resolve => {
      engine.stop()
      const closeHttp = () => { server.close(() => resolve()); server.closeAllConnections?.() }
      if (vite) vite.close().then(closeHttp, closeHttp)
      else closeHttp()
    }),
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.() })
}

function listenWithFallback(server: Server, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
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
