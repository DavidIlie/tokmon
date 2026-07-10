import { randomBytes } from 'node:crypto'
import { loadConfig } from '../config'
import { flushDisk } from '../providers/usage-core'
import { startWebServer, type WebServerController } from './server'
import { browserUrl, openBrowser } from './open'
import { appVersion } from './static'
import {
  acquireLock,
  isAlive,
  readLock,
  reclaimAbandonedLock,
  reclaimDeadLock,
  unlinkLock,
  verifyLock,
  writeLock,
  type DaemonLock,
} from './lockfile'

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

const SERVE_HELP = `tokmon serve - Launch the tokmon web dashboard (local, loopback only)

Usage: tokmon serve [options]

Options:
  -p, --port <n>   Port to listen on (default: 4317, auto-falls back if taken)
      --no-open    Don't open the browser automatically
  -h, --help       Show this help
`

export interface RunDaemonOptions { foreground: boolean }

function handshake(lock: DaemonLock): void {
  process.stdout.write(JSON.stringify({ ready: 1, url: lock.url, port: lock.port, wsToken: lock.wsToken, version: lock.version }) + '\n')
}

function describeExisting(lock: DaemonLock, open: boolean): void {
  const displayUrl = open ? lock.url : browserUrl(lock.url, lock.wsToken)
  process.stdout.write(`\n  ◆ tokmon web  →  ${displayUrl}\n`)
  process.stdout.write('    reusing the live singleton daemon\n\n')
  if (open) {
    openBrowser(lock.url, lock.wsToken)
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

  const version = appVersion()
  let current = readLock()
  // Invalid or legacy files are not trusted as locks. Reclaim them only when
  // their recorded owner is dead, or when an ownerless partial is old enough
  // that it cannot be an in-progress atomic acquisition.
  if (!current && reclaimAbandonedLock()) current = readLock()
  const live = await verifyLock(current, version)
  if (live) {
    if (opts.foreground) describeExisting(live, open)
    else handshake(live)
    return
  }

  // A concurrent child has acquired the reservation but has not published its
  // listening port yet. Wait for that owner instead of starting a second daemon.
  if (current?.state === 'starting' && current.version === version && isAlive(current.pid)) {
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      const winner = await verifyLock(readLock(), version, 250)
      if (winner) {
        if (opts.foreground) describeExisting(winner, open)
        else handshake(winner)
        return
      }
    }
  }

  // Never remove a live, incompatible daemon: it might belong to another version.
  // The caller can stop it explicitly; silently replacing it would violate singleton ownership.
  if (current && isAlive(current.pid)) {
    const message = 'tokmon: another daemon owns the lock but could not be verified (version/token mismatch)'
    if (opts.foreground) { process.stderr.write(message + '\n'); process.exitCode = 1 }
    return
  }
  if (current) reclaimDeadLock()

  const ownerId = randomBytes(32).toString('base64url')
  const token = randomBytes(32).toString('base64url')
  const reservation: DaemonLock = {
    pid: process.pid,
    port: 0,
    url: '',
    wsToken: token,
    version,
    startedAt: Date.now(),
    ownerId,
    state: 'starting',
  }

  if (!acquireLock(reservation)) {
    // Another TUI won the race. It may still be publishing its ready lock.
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      const winner = await verifyLock(readLock(), version, 250)
      if (winner) {
        if (opts.foreground) describeExisting(winner, open)
        else handshake(winner)
        return
      }
    }
    if (opts.foreground) { process.stderr.write('tokmon: daemon startup is already in progress\n'); process.exitCode = 1 }
    return
  }

  let controller: WebServerController | null = null
  try {
    const config = await loadConfig()
    controller = await startWebServer({ config, port, log: opts.foreground, wsToken: token })
    const ready: DaemonLock = {
      ...reservation,
      port: controller.port,
      url: controller.url,
      state: 'ready',
    }
    if (!writeLock(ready)) throw new Error('lost daemon lock ownership during startup')

    let shuttingDown = false
    const shutdown = async (exitCode = 0) => {
      if (shuttingDown) return
      shuttingDown = true
      if (opts.foreground) process.stdout.write('\n  stopping tokmon web…\n')
      try { await controller?.stop() } catch {}
      await flushDisk().catch(() => {})
      unlinkLock(ownerId)
      process.exit(exitCode)
    }
    process.once('exit', () => { unlinkLock(ownerId) })
    process.once('SIGINT', () => { void shutdown(0) })
    process.once('SIGTERM', () => { void shutdown(0) })

    if (opts.foreground) {
      const displayUrl = open ? controller.url : controller.browserUrl
      process.stdout.write(`\n  ◆ tokmon web  →  ${displayUrl}\n`)
      process.stdout.write('    live dashboard · Ctrl-C to stop\n\n')
      if (open) {
        openBrowser(controller.url, token)
        process.stdout.write('    opening browser…\n')
      }
    } else {
      // No stdin coupling: this process is a durable daemon, not a child of one TUI.
      handshake(ready)
    }
    await new Promise<void>(() => {})
  } catch (error) {
    try { await controller?.stop() } catch {}
    unlinkLock(ownerId)
    const message = `tokmon: failed to start web server: ${(error as Error).message}`
    if (opts.foreground) { process.stderr.write(message + '\n'); process.exitCode = 1 }
  }
}
