import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'

export interface ViteDevServerLike {
  middlewares: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void
  warmupRequest?: (url: string) => Promise<void>
  close: () => Promise<void>
}

export function isDevMode(): boolean {
  const forced = process.env.TOKMON_WEB_MODE
  if (forced === 'dev') return true
  if (forced === 'prod') return false
  return import.meta.url.includes('/src/')
}

export function findWebSource(): string | null {
  for (const rel of ['../../web/', '../web/', './web/']) {
    try {
      const dir = fileURLToPath(new URL(rel, import.meta.url))
      if (existsSync(join(dir, 'vite.config.ts')) && existsSync(join(dir, 'index.html'))) {
        return dir.replace(/[\\/]+$/, '')
      }
    } catch {}
  }
  return null
}

export async function createViteDevServer(httpServer: Server, log: (m: string) => void): Promise<ViteDevServerLike | null> {
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

export const MISSING_BUILD_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>tokmon web</title>
<style>body{background:#0a0d0e;color:#cdd6d8;font:14px ui-monospace,Menlo,monospace;padding:3rem;line-height:1.7}
code{color:#e6b450}</style></head><body>
<h1 style="color:#00d787">tokmon web</h1>
<p>The dashboard isn't available.</p>
<p><b>Prod:</b> run <code>npm run build</code> (builds <code>dist/web</code>), then <code>tokmon serve</code>.</p>
<p><b>Dev:</b> run <code>pnpm --prefix web install</code> so the Vite dev server (HMR) can start.</p>
</body></html>`
