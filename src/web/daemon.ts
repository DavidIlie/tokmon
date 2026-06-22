import { loadConfig } from '../config'
import { flushDisk } from '../providers/usage-core'
import { startWebServer, type WebServerController } from './server'
import { openBrowser } from './open'
import { appVersion } from './static'
import { readLock, writeLock, unlinkLock, isAlive, probeHealth } from './lockfile'

// ── arg parsing (shared by serve/web foreground + __daemon child) ────────────
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
  // Accept 0 as a valid request for an OS-ASSIGNED ephemeral port (the TUI's
  // private daemon spawns with `--port 0` so it never collides with serve's 4317
  // or another TUI instance). Only NaN / out-of-range values fall back to the
  // default. server.listen(0) then binds a free port and we read it back.
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
  // foreground: `tokmon serve`/`web` — print URL, open browser, park until SIGINT.
  // background (child): spawned by the TUI — emit a one-line JSON handshake on
  // stdout, NO browser, die with the parent.
  foreground: boolean
}

// runDaemon is the single entry for both daemon roles (foreground serve/web +
// the TUI's spawned __daemon child). Both own the SAME server (createDataEngine)
// — the ONLY refresh-loop runner, the ONLY flushDisk caller, the ONLY
// web-snapshot.json / daemon.json writer.
export async function runDaemon(args: string[], opts: RunDaemonOptions): Promise<void> {
  const { port, open, help } = parseDaemonArgs(args)
  if (help && opts.foreground) { process.stdout.write(SERVE_HELP); return }

  // ── serve/web front door (foreground only): dedup against a live daemon ──────
  // A second `tokmon serve` should NOT steal the port or double-run the engine.
  // If the lockfile points at a LIVE daemon of the SAME version, no-op: print its
  // URL and (optionally) open the browser, then return. A DIFFERENT version (or a
  // dead/stale pid) means we spawn fresh — startWebServer's EADDRINUSE walk picks
  // a free port so we never steal another version's daemon.
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

  // Advertise via the lockfile (serve-dedup + version checks) — FOREGROUND ONLY.
  // The TUI's ephemeral child must NOT write daemon.json: it would clobber a
  // standalone `serve` daemon's entry and break serve-dedup. The child is
  // discovered by its stdout handshake instead, never the lockfile.
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

  // Best-effort lockfile cleanup if we exit through any other path (foreground
  // owns the lockfile; the child never wrote one, so nothing to unlink).
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
    // CHILD MODE: the handshake MUST be the first thing the parent reads on
    // stdout (the parent spawns with stdio: ['pipe','pipe','ignore'] and reads
    // one line). No browser is opened; the TUI owns the browser-open keybind.
    //
    // ORPHAN REAPING: detached:false does NOT make the OS kill us when the
    // parent dies (it only shares the process group) — a SIGKILL/crash of the
    // TUI would otherwise leave us holding the port forever. So we ALSO self-exit
    // when our stdin pipe closes: the kernel closes the parent's write end the
    // moment the parent process goes away (even on SIGKILL, where the parent's
    // own teardown hooks never run). The handle's explicit SIGTERM remains the
    // fast path for graceful exits; stdin-close is the crash-safety backstop.
    // Windows caveat: POSIX signals are unreliable there (SIGTERM/SIGINT may not
    // fire on console close), so this stdin-close path is the PRIMARY reaper on
    // Windows; graceful flushDisk is not guaranteed on a hard parent kill.
    const selfExit = () => { void shutdown(0) }
    process.stdin.on('end', selfExit)
    process.stdin.on('close', selfExit)
    process.stdin.on('error', selfExit)
    process.stdin.resume()
    process.stdout.write(JSON.stringify({ ready: 1, url: controller.url, port: controller.port, wsToken: controller.wsToken, version }) + '\n')
  }

  await new Promise<void>(() => {})
}
