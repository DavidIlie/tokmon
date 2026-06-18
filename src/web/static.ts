import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extname, join, normalize, sep } from 'node:path'
import type { ServerResponse } from 'node:http'

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

export function findWebRoot(): string | null {
  const candidates = ['./web/', '../web/', '../dist/web/', '../../dist/web/']
  for (const rel of candidates) {
    try {
      const dir = fileURLToPath(new URL(rel, import.meta.url))
      if (existsSync(join(dir, 'index.html'))) return dir.replace(/[\\/]+$/, '')
    } catch {}
  }
  return null
}

function resolveStaticPath(webRoot: string, urlPath: string): string | null {
  let clean: string
  try { clean = decodeURIComponent(urlPath.split('?')[0]) } catch { return null }
  const rel = normalize(clean).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  const full = join(webRoot, rel)
  if (full !== webRoot && !full.startsWith(webRoot + sep)) return null
  return full
}

export function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data))
}

export function serveStatic(webRoot: string, urlPath: string, res: ServerResponse): void {
  const path = urlPath.split('?')[0]
  const filePath = resolveStaticPath(webRoot, path === '/' ? '/index.html' : path)
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
    const indexPath = join(webRoot, 'index.html')
    if (!existsSync(indexPath)) { send(res, 404, 'text/plain', 'not found'); return }
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' })
    createReadStream(indexPath).on('error', () => { try { res.destroy() } catch {} }).pipe(res)
  })
}

export function appVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const p = fileURLToPath(new URL(rel, import.meta.url))
      const pkg = JSON.parse(readFileSync(p, 'utf-8'))
      if (typeof pkg.version === 'string') return pkg.version
    } catch {}
  }
  return ''
}
