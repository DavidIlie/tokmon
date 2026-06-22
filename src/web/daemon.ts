import { loadConfig } from '../config'
import { flushDisk } from '../providers/usage-core'
import { startWebServer, type WebServerController } from './server'
import { openBrowser } from './open'
import { appVersion } from './static'
import { readLock, writeLock, unlinkLock, isAlive, probeHealth } from './lockfile'

interface DaemonArgs { port?: number; open: boolean; help: boolean }

function parseDaemonArgs(args: string[]): DaemonArgs {
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
  // --port 0 = OS-assigned ephemeral port for the TUI's private daemon.
  if (port !== undefined && (!Number.isFinite(port) || port < 0 || port > 65535)) port = undefined
  return { port, open, help }
}

const SERVE_HELP = `tokmon serve - Launch the tokmon web dashboard (local, loopback only)

Usage: tokmon serve [options]

Options:
  -p, --port <n>   Port to listen on (default: 4317, auto-falls back if taken)
      --no-open    Don't open the browser automatically
  -h, --help       Show this help
`

export interface RunDaemonOptions {
  foreground: boolean
}

export async function runDaemon(args: string[], opts: RunDaemonOptions): Promise<void> {
  const { port, open, help } = parseDaemonArgs(args)
  if (help && opts.foreground) { process.stdout.write(SERVE_HELP); return }

  if (opts.foreground && port === undefined) {
    const lock = readLock()
    if (lock && lock.version === appVersion() && isAlive(lock.pid) && await probeHealth(lock.url)) {
      process.stdout.write(`\n  ◆ tokmon web already running  →  ${lock.url}\n`)
      process.stdout.write(`    reusing the live dashboard (started by another tokmon)\n\n`)
      if (open) { openBrowser(lock.url); process.stdout.write(`    opening browser…\n`) }
      return
    }
  }

  const config = await loadConfig()
  let controller: WebServerController
  try {
    controller = await startWebServer({ config, port, log: opts.foreground })
  } catch (err) {
    const msg = `tokmon: failed to start web server: ${(err as Error).message}`
    process.stderr.write(msg + '\n')
    process.exitCode = 1
    return
  }

  const version = appVersion()
  if (opts.foreground) {
    writeLock({
      pid: process.pid,
      port: controller.port,
      url: controller.url,
      wsToken: controller.wsToken,
      version,
      startedAt: Date.now(),
    })
  }

  let shuttingDown = false
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    if (opts.foreground) { process.stdout.write('\n  stopping tokmon web…\n'); unlinkLock() }
    try { await controller.stop() } catch {}
    await flushDisk()
    process.exit(exitCode)
  }

  if (opts.foreground) process.once('exit', () => { unlinkLock() })
  process.on('SIGINT', () => { void shutdown(0) })
  process.on('SIGTERM', () => { void shutdown(0) })

  if (opts.foreground) {
    process.stdout.write(`\n  ◆ tokmon web  →  ${controller.url}\n`)
    process.stdout.write(`    live dashboard · Ctrl-C to stop\n\n`)
    if (open) {
      openBrowser(controller.url)
      process.stdout.write(`    opening browser…\n`)
    }
  } else {
    // Child mode: emit handshake on stdout, then wait for stdin close (orphan reaping backstop).
    const selfExit = () => { void shutdown(0) }
    process.stdin.on('end', selfExit)
    process.stdin.on('close', selfExit)
    process.stdin.on('error', selfExit)
    process.stdin.resume()
    process.stdout.write(JSON.stringify({ ready: 1, url: controller.url, port: controller.port, wsToken: controller.wsToken, version }) + '\n')
  }

  await new Promise<void>(() => {})
}
