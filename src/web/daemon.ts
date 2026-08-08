import { acquireOrAttachDaemon, type DaemonController } from './daemon-controller'
import { openBrowser } from './open'
import { readLock, unlinkLock, type DaemonLock } from './lockfile'

const LOCK_SELF_CHECK_INTERVAL_MS = 30_000

interface DaemonArgs { port?: number; open: boolean; help: boolean }

function parseDaemonArgs(args: string[]): DaemonArgs {
  let port: number | undefined
  let open = true
  let help = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if ((arg === '--port' || arg === '-p') && args[i + 1]) port = Number(args[++i])
    else if (arg.startsWith('--port=')) port = Number(arg.slice('--port='.length))
    else if (arg === '--no-open') open = false
    else if (arg === '--help' || arg === '-h') help = true
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) port = undefined
  return { port, open, help }
}

const SERVE_HELP = `tokmon serve - Launch the tokmon web dashboard

Usage: tokmon serve [options]

Options:
  -p, --port <n>   Port to listen on (default: 4317, auto-falls back if taken)
      --no-open    Don't open the browser automatically
  -h, --help       Show this help
`

export interface RunDaemonOptions { foreground: boolean }

function handshake(lock: DaemonLock): void {
  process.stdout.write(JSON.stringify({
    ready: 1,
    url: lock.url,
    port: lock.port,
    wsToken: lock.wsToken,
    version: lock.version,
    protocolVersion: lock.protocolVersion,
    capabilities: lock.capabilities,
    ownerKind: lock.ownerKind,
    channel: lock.channel,
  }) + '\n')
}

function describeExisting(lock: DaemonLock, open: boolean): void {
  process.stdout.write(`\n  ◆ tokmon web  →  ${lock.url}\n`)
  process.stdout.write('    reusing the live singleton daemon\n\n')
  if (open) {
    openBrowser(lock.url)
    process.stdout.write('    opening browser…\n')
  }
}

/**
 * Starts (or discovers) the one owner daemon. The on-disk reservation is acquired
 * before allocating web resources, making races between many TUIs deterministic.
 */
export async function runDaemon(args: string[], opts: RunDaemonOptions): Promise<void> {
  const { port, open, help } = parseDaemonArgs(args)
  if (help && opts.foreground) { process.stdout.write(SERVE_HELP); return }

  let daemon: DaemonController
  try {
    daemon = await acquireOrAttachDaemon({
      ownerKind: 'cli',
      port,
      log: opts.foreground,
    })
  } catch (error) {
    const message = `tokmon: failed to start web server: ${(error as Error).message}`
    if (opts.foreground) { process.stderr.write(message + '\n'); process.exitCode = 1 }
    return
  }

  if (daemon.role === 'attached') {
    if (opts.foreground) describeExisting(daemon.lock, open)
    else handshake(daemon.lock)
    return
  }

  let shuttingDown = false
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    if (opts.foreground) process.stdout.write('\n  stopping tokmon web…\n')
    await daemon.stop()
    process.exit(exitCode)
  }
  process.once('exit', () => { unlinkLock(daemon.lock.ownerId) })
  process.once('SIGINT', () => { void shutdown(0) })
  process.once('SIGTERM', () => { void shutdown(0) })

  // Reclaim paths can unlink this daemon's lock while it is merely slow (e.g.
  // right after wake) rather than dead. Without a self-check the orphan keeps
  // running unowned forever, holding its port and burning refresh cycles
  // beside the replacement daemon. Eventual consistency: notice and exit.
  const selfCheck = setInterval(() => {
    const current = readLock()
    if (current?.ownerId === daemon.lock.ownerId && current.pid === process.pid) return
    if (opts.foreground) process.stdout.write('\n  daemon lock lost or replaced — shutting down\n')
    void shutdown(0)
  }, LOCK_SELF_CHECK_INTERVAL_MS)
  selfCheck.unref?.()

  if (opts.foreground) {
    process.stdout.write(`\n  ◆ tokmon web  →  ${daemon.baseUrl}\n`)
    process.stdout.write('    live dashboard · Ctrl-C to stop\n\n')
    if (daemon.config?.allowNetworkAccess) {
      process.stdout.write('    ⚠ unsafe network access enabled — dashboard is reachable from your LAN\n\n')
    }
    if (open) {
      openBrowser(daemon.baseUrl)
      process.stdout.write('    opening browser…\n')
    }
  } else {
    // No stdin coupling: this process is a durable daemon, not a child of one TUI.
    handshake(daemon.lock)
  }
  await new Promise<void>(() => {})
}
