import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { extname, join, normalize, sep } from 'node:path'
import type { Config } from '../config'
import type { DashboardData, TableData } from '../types'
import type { BillingResult } from '../providers/types'
import {
  assembleSnapshot, fetchAccountBilling, fetchAccountSummary, fetchAccountTable, resolveAccounts, tzFor,
  type ResolvedAccount,
} from './data'
import type { WebSnapshot } from './contract'

// SECURITY: web server must only be reachable from localhost.
const HOST = '127.0.0.1'

const DEFAULT_PORT = 4317
const MAX_PORT_TRIES = 20
const MIN_SUMMARY_INTERVAL_MS = 8000
const TABLE_INTERVAL_MS = 300_000
const BILLING_INTERVAL_FALLBACK_MIN = 5
const SSE_HEARTBEAT_MS = 25_000
// Skip refreshes when no SSE clients and idle—keeps CPU near-zero.
const IDLE_PAUSE_MS = 60_000

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

export interface WebServerController {
  url: string
  port: number
  /** Current snapshot, or null before the first fetch completes. */
  snapshot(): WebSnapshot | null
  stop(): Promise<void>
}

export interface StartOptions {
  config: Config
  port?: number
  log?: boolean
}

function appVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const p = fileURLToPath(new URL(rel, import.meta.url))
      const pkg = JSON.parse(readFileSync(p, 'utf-8'))
      if (typeof pkg.version === 'string') return pkg.version
    } catch { /* try next candidate */ }
  }
  return ''
}

/** Locate the built SPA bundle (dist/web) — prod mode serves this statically. */
function findWebRoot(): string | null {
  const candidates = ['./web/', '../web/', '../dist/web/', '../../dist/web/']
  for (const rel of candidates) {
    try {
      const dir = fileURLToPath(new URL(rel, import.meta.url))
      if (existsSync(join(dir, 'index.html'))) return dir.replace(/[\\/]+$/, '')
    } catch { /* try next */ }
  }
  return null
}

/** Locate the web/ SOURCE dir (with vite.config.ts) — dev mode serves this via Vite. */
function findWebSource(): string | null {
  for (const rel of ['../../web/', '../web/', './web/']) {
    try {
      const dir = fileURLToPath(new URL(rel, import.meta.url))
      if (existsSync(join(dir, 'vite.config.ts')) && existsSync(join(dir, 'index.html'))) {
        return dir.replace(/[\\/]+$/, '')
      }
    } catch { /* try next */ }
  }
  return null
}

/** dev = running from source via tsx; prod = bundled in dist. Overridable. */
function isDevMode(): boolean {
  const forced = process.env.TOKMON_WEB_MODE
  if (forced === 'dev') return true
  if (forced === 'prod') return false
  return import.meta.url.includes('/src/')
}

// Minimal slice of Vite's dev server we use (Vite isn't a dependency of the CLI;
// in dev we resolve it from web/node_modules at runtime, so it's typed loosely).
interface ViteDevServerLike {
  middlewares: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void
  close: () => Promise<void>
}

/** Start Vite in middleware mode against web/ source, sharing the http server for HMR. */
async function createViteDevServer(httpServer: Server, log: (m: string) => void): Promise<ViteDevServerLike | null> {
  const root = findWebSource()
  if (!root) { log('  ⚠ dev mode: web/ source not found'); return null }
  try {
    const req = createRequire(pathToFileURL(join(root, 'package.json')).href)
    const vitePath = req.resolve('vite')
    const vite = await import(pathToFileURL(vitePath).href) as { createServer: (o: unknown) => Promise<ViteDevServerLike> }
    const dev = await vite.createServer({
      root,
      configFile: join(root, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: 'spa',
      clearScreen: false,
      logLevel: 'warn',
    })
    log('  ◆ dev mode — Vite HMR attached (edit web/src and it hot-reloads)')
    return dev
  } catch (e) {
    log(`  ⚠ couldn't start Vite dev server: ${(e as Error).message}`)
    log('    run `pnpm --prefix web install` (or `npm run web:install`) for HMR, or `npm run build` for a static bundle')
    return null
  }
}

const MISSING_BUILD_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>tokmon web</title>
<style>body{background:#0a0d0e;color:#cdd6d8;font:14px ui-monospace,Menlo,monospace;padding:3rem;line-height:1.7}
code{color:#e6b450}</style></head><body>
<h1 style="color:#00d787">tokmon web</h1>
<p>The dashboard isn't available.</p>
<p><b>Prod:</b> run <code>npm run build</code> (builds <code>dist/web</code>), then <code>tokmon serve</code>.</p>
<p><b>Dev:</b> run <code>pnpm --prefix web install</code> so the Vite dev server (HMR) can start.</p>
</body></html>`

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data))
}

function resolveStatic(webRoot: string, urlPath: string): string | null {
  let clean: string
  try { clean = decodeURIComponent(urlPath.split('?')[0]) } catch { return null } // malformed %-encoding
  const rel = normalize(clean).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  const full = join(webRoot, rel)
  if (full !== webRoot && !full.startsWith(webRoot + sep)) return null
  return full
}

export async function startWebServer(opts: StartOptions): Promise<WebServerController> {
  const { config } = opts
  const tz = tzFor(config)
  const version = appVersion()
  const summaryIntervalMs = Math.max(MIN_SUMMARY_INTERVAL_MS, (config.interval || 2) * 1000)
  const billingIntervalMs = Math.max(1, config.billingInterval || BILLING_INTERVAL_FALLBACK_MIN) * 60_000
  const log = (msg: string) => { if (opts.log) process.stdout.write(msg + '\n') }

  // Mode is resolved after the http server exists (Vite needs it for HMR).
  let webRoot: string | null = null
  let vite: ViteDevServerLike | null = null
  const resolved: ResolvedAccount[] = await resolveAccounts(config)
  const usage = new Map<string, { dashboard: DashboardData | null; table: TableData | null }>()
  const billing = new Map<string, BillingResult | null>()
  let current: WebSnapshot | null = null
  const sseClients = new Map<ServerResponse, ReturnType<typeof setInterval>>()
  let lastActivity = Date.now()
  let stopped = false
  const idle = () => sseClients.size === 0 && Date.now() - lastActivity > IDLE_PAUSE_MS

  const rebuild = () => {
    if (stopped) return
    current = assembleSnapshot({ version, tz, intervalMs: summaryIntervalMs, resolved, usage, billing })
    if (sseClients.size === 0) return
    const payload = `event: snapshot\ndata: ${JSON.stringify(current)}\n\n`
    for (const res of sseClients.keys()) {
      try { res.write(payload) } catch {}
    }
  }

  const usageEntry = (id: string) => {
    let u = usage.get(id)
    if (!u) { u = { dashboard: null, table: null }; usage.set(id, u) }
    return u
  }

  const usageAccounts = resolved.filter(r => r.hasUsage)

  let summaryBusy = false
  const refreshSummary = async (force = false) => {
    if (stopped || summaryBusy || (!force && idle())) return
    summaryBusy = true
    try {
      // Serialized so peak CPU stays ~1 core.
      for (const r of usageAccounts) {
        if (stopped) return
        usageEntry(r.account.id).dashboard = await fetchAccountSummary(r.account, tz)
      }
      rebuild()
    } finally {
      summaryBusy = false
    }
  }

  let tableBusy = false
  const refreshTable = async (force = false) => {
    if (stopped || tableBusy || (!force && idle())) return
    tableBusy = true
    try {
      for (const r of usageAccounts) {
        if (stopped) return
        usageEntry(r.account.id).table = await fetchAccountTable(r.account, tz)
      }
      rebuild()
    } finally {
      tableBusy = false
    }
  }

  const billingAccounts = resolved.filter(r => r.hasBilling)

  let billingBusy = false
  const refreshBilling = async (force = false) => {
    if (stopped || billingBusy || (!force && idle())) return
    billingBusy = true
    try {
      for (const r of billingAccounts) {
        if (stopped) return
        billing.set(r.account.id, await fetchAccountBilling(r.account))
      }
      rebuild()
    } finally {
      billingBusy = false
    }
  }

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url || '/'
    const path = url.split('?')[0]

    if (path === '/api/data') {
      lastActivity = Date.now()
      sendJson(res, 200, current ?? { pending: true })
      return
    }

    if (path === '/healthz') {
      sendJson(res, 200, { ok: true, ready: current !== null })
      return
    }

    if (path === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })
      res.write('retry: 3000\n\n')
      if (current) res.write(`event: snapshot\ndata: ${JSON.stringify(current)}\n\n`)
      const beat = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, SSE_HEARTBEAT_MS)
      beat.unref?.()
      sseClients.set(res, beat)
      lastActivity = Date.now()
      // A viewer arrived — make sure data is fresh. Force both the summary and
      // the (heavier) table so charts have data on first paint / after idle.
      if (!current || Date.now() - current.generatedAt > summaryIntervalMs) {
        void refreshSummary(true)
        void refreshTable(true)
      }
      req.on('close', () => { clearInterval(beat); sseClients.delete(res) })
      return
    }

    // Dev: hand everything non-API to Vite (transforms, HMR client, SPA fallback).
    if (vite) {
      vite.middlewares(req, res, () => { send(res, 404, 'text/plain', 'not found') })
      return
    }

    if (!webRoot) {
      send(res, 503, 'text/html; charset=utf-8', MISSING_BUILD_HTML)
      return
    }

    const root = webRoot
    const filePath = resolveStatic(root, path === '/' ? '/index.html' : path)
    if (!filePath) { send(res, 403, 'text/plain', 'forbidden'); return }

    void stat(filePath).then(st => {
      if (st.isFile()) {
        const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
        const immutable = filePath.includes(`${sep}assets${sep}`)
        res.writeHead(200, {
          'Content-Type': type,
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        })
        createReadStream(filePath).pipe(res)
      } else {
        throw new Error('not a file')
      }
    }).catch(() => {
      if (extname(path)) { send(res, 404, 'text/plain', 'not found'); return }
      const indexPath = join(root, 'index.html')
      if (!existsSync(indexPath)) { send(res, 404, 'text/plain', 'not found'); return }
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' })
      createReadStream(indexPath).on('error', () => { try { res.destroy() } catch {} }).pipe(res)
    })
  }

  const server = createServer(handler)

  // Choose mode now that the server exists: dev → Vite HMR; prod → static dist/web.
  if (isDevMode()) vite = await createViteDevServer(server, log)
  if (!vite) webRoot = findWebRoot()

  const port = await listenWithFallback(server, opts.port ?? DEFAULT_PORT)
  const serverUrl = `http://${HOST}:${port}`
  if (!vite && !webRoot) log('  ⚠ no dashboard available — see the page for build/dev instructions')

  void refreshSummary(true)
  void refreshTable(true)
  void refreshBilling(true)
  const summaryTimer = setInterval(() => { void refreshSummary() }, summaryIntervalMs)
  const tableTimer = setInterval(() => { void refreshTable() }, TABLE_INTERVAL_MS)
  const billingTimer = setInterval(() => { void refreshBilling() }, billingIntervalMs)
  summaryTimer.unref?.()
  tableTimer.unref?.()
  billingTimer.unref?.()

  return {
    url: serverUrl,
    port,
    snapshot: () => current,
    stop: () => new Promise<void>(resolve => {
      stopped = true // halt in-flight refreshes between accounts / before rebuild
      clearInterval(summaryTimer)
      clearInterval(tableTimer)
      clearInterval(billingTimer)
      for (const [res, beat] of sseClients) { clearInterval(beat); try { res.end() } catch {} }
      sseClients.clear()
      const closeHttp = () => { server.close(() => resolve()); server.closeAllConnections?.() }
      // Close Vite first (stops HMR ws + file watchers), then the http server.
      if (vite) vite.close().then(closeHttp, closeHttp)
      else closeHttp()
    }),
  }
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
