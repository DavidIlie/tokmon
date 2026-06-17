import { loadConfig } from '../config'
import { flushDisk } from '../providers/usage-core'
import { startWebServer, type WebServerController } from './server'
import { openBrowser } from './open'

export { startWebServer, type WebServerController } from './server'

function parseServeArgs(args: string[]): { port?: number; open: boolean; help: boolean } {
  let port: number | undefined
  let open = true
  let help = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if ((a === '--port' || a === '-p') && args[i + 1]) { port = Number(args[++i]) }
    else if (a.startsWith('--port=')) { port = Number(a.slice('--port='.length)) }
    else if (a === '--no-open') { open = false }
    else if (a === '--help' || a === '-h') { help = true }
  }
  if (port !== undefined && (!Number.isFinite(port) || port < 1 || port > 65535)) port = undefined
  return { port, open, help }
}

const SERVE_HELP = `tokmon serve - Launch the tokmon web dashboard (local, loopback only)

Usage: tokmon serve [options]

Options:
  -p, --port <n>   Port to listen on (default: 4317, auto-falls back if taken)
      --no-open    Don't open the browser automatically
  -h, --help       Show this help
`

export async function startWeb(args: string[]): Promise<void> {
  const { port, open, help } = parseServeArgs(args)
  if (help) { process.stdout.write(SERVE_HELP); return }

  const config = await loadConfig()
  let controller: WebServerController
  try {
    controller = await startWebServer({ config, port, log: true })
  } catch (err) {
    process.stderr.write(`tokmon: failed to start web server: ${(err as Error).message}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(`\n  ◆ tokmon web  →  ${controller.url}\n`)
  process.stdout.write(`    live dashboard · Ctrl-C to stop\n\n`)
  if (open) {
    openBrowser(controller.url)
    process.stdout.write(`    opening browser…\n`)
  }

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    process.stdout.write('\n  stopping tokmon web…\n')
    await controller.stop()
    await flushDisk()
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })

  await new Promise<void>(() => {})
}
