// NODE-ONLY. Spawns + supervises the TUI's private ephemeral daemon.
//
// v1 policy (per blueprint decision #2): the TUI ALWAYS spawns its OWN daemon
// on an OS-ephemeral port (`__daemon --port 0 --no-open`) — no attach to a
// pre-existing serve daemon. The lockfile is reserved for the `tokmon serve`
// front door, not for this attach path.
//
// TEARDOWN / ORPHAN REAPING: detached:false does NOT make the OS reap the child
// when the parent dies (it only shares the process group). So we use TWO
// mechanisms: (1) an explicit SIGTERM from the parent's exit/SIGINT/SIGTERM
// hooks (graceful, fast — frees the port and runs the daemon's flushDisk), and
// (2) we spawn the child with stdin as a PIPE and never write to it; when the
// parent dies — INCLUDING a SIGKILL/crash where (1) never runs — the kernel
// closes the parent's write end, the child sees stdin 'end'/'close', and
// self-exits (see daemon.ts child mode). Windows caveat: POSIX signals are
// unreliable there, so the stdin-close path is the primary reaper on Windows.
//
// If the child can't be spawned or doesn't emit its stdout handshake within
// ~3s, we resolve to a DEGRADED handle (baseUrl=null): the caller then runs
// today's in-process loops behind `if (mode === 'degraded')`. Never blocks.

import { spawn, type ChildProcess } from 'node:child_process'
import { extname } from 'node:path'

const HANDSHAKE_TIMEOUT_MS = 3000

export type DaemonKind = 'spawned' | 'degraded'

export interface DaemonHandle {
  kind: DaemonKind
  // null in degraded mode (no daemon reachable).
  baseUrl: string | null
  wsToken: string | null
  // Idempotent teardown: SIGTERM the child and remove the exit/SIGINT hooks.
  stop(): void
}

export interface AttachOrSpawnOptions {
  // Override the entry script + node binary (testing). Defaults to the running
  // CLI entry (process.argv[1]) executed by process.execPath.
  entry?: string
  execPath?: string
  // Override the runtime exec args prepended before the entry (testing). In dev
  // (tsx) these carry the loader flags so the child can load a .ts/.tsx entry.
  execArgv?: string[]
  timeoutMs?: number
}

// In dev (`tsx src/cli.tsx`), process.execPath is plain node and the entry is a
// .ts/.tsx SOURCE file that plain node can't load (ERR_UNKNOWN_FILE_EXTENSION).
// Forward tsx's own loader flags (carried in process.execArgv as
// `--require .../preflight.cjs --import .../loader.mjs`) so the child runtime
// matches the parent and reaches CONNECTED in dev, not just in built dist.
function runtimeExecArgv(entry: string, override?: string[]): string[] {
  if (override) return override
  const ext = extname(entry).toLowerCase()
  if (ext !== '.ts' && ext !== '.tsx' && ext !== '.mts' && ext !== '.cts') return []
  // Preserve only the loader-establishing flags AND their value args (each of
  // --require/--import/--loader is followed by a separate path element in
  // execArgv). Drop one-off flags like --eval that appear when the parent
  // itself was started with -e. Supports both "--flag value" and "--flag=value".
  const keepFlags = ['--require', '--import', '--loader']
  const out: string[] = []
  const src = process.execArgv
  for (let i = 0; i < src.length; i++) {
    const a = src[i]
    if (a.startsWith('--experimental-')) { out.push(a); continue }
    const matched = keepFlags.find(f => a === f || a.startsWith(f + '='))
    if (!matched) continue
    out.push(a)
    // "--require /path" form: the value is the next element.
    if (a === matched && i + 1 < src.length) out.push(src[++i])
  }
  return out
}

// The handshake line the child writes as its FIRST stdout line (daemon.ts).
interface Handshake { ready: 1; url: string; port: number; wsToken: string; version: string }

function parseHandshake(line: string): Handshake | null {
  try {
    const o = JSON.parse(line) as Partial<Handshake>
    if (o && o.ready === 1 && typeof o.url === 'string' && typeof o.wsToken === 'string') return o as Handshake
    return null
  } catch {
    return null
  }
}

export function attachOrSpawn(opts: AttachOrSpawnOptions = {}): Promise<DaemonHandle> {
  const entry = opts.entry ?? process.argv[1]
  const execPath = opts.execPath ?? process.execPath
  const timeoutMs = opts.timeoutMs ?? HANDSHAKE_TIMEOUT_MS

  // No resolvable entry -> can't spawn; degrade immediately.
  if (!entry) return Promise.resolve(degraded())

  return new Promise<DaemonHandle>((resolve) => {
    // The daemon reads interval/tz/etc. from config on disk; nothing is
    // forwarded on the wire here (parseDaemonArgs only knows --port/--no-open).
    const args = ['__daemon', '--port', '0', '--no-open']
    const execArgv = runtimeExecArgv(entry, opts.execArgv)

    let child: ChildProcess
    try {
      // stdin: 'pipe' (never written) — the orphan-reaping backstop: when the
      //   parent dies the kernel closes our write end, the child sees stdin
      //   'end'/'close' and self-exits (daemon.ts child mode) even on SIGKILL.
      // stdout: 'pipe' — the handshake line.
      // stderr: 'ignore' — we don't surface child stderr; ignoring avoids an
      //   undrained ~64KB pipe filling and blocking the daemon's writes.
      child = spawn(execPath, [...execArgv, entry, ...args], {
        stdio: ['pipe', 'pipe', 'ignore'],
        detached: false,
      })
    } catch {
      resolve(degraded())
      return
    }

    let settled = false
    let stdoutBuf = ''
    let stopped = false

    // Kill the child when the parent exits or is interrupted (graceful fast
    // path; the stdin-close backstop in the child covers SIGKILL/crash where
    // these hooks never run). SIGTERM frees the port + runs flushDisk.
    const onExit = () => { try { if (!stopped) child.kill('SIGTERM') } catch {} }
    const onSignal = () => { onExit() }
    process.once('exit', onExit)
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)

    const removeHooks = () => {
      process.removeListener('exit', onExit)
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
    }

    const stop = () => {
      if (stopped) return
      stopped = true
      removeHooks()
      try { child.kill('SIGTERM') } catch {}
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      // No handshake in time -> kill the (possibly hung) child and degrade.
      try { child.kill('SIGTERM') } catch {}
      removeHooks()
      resolve(degraded())
    }, timeoutMs)
    timer.unref?.()

    const finishSpawned = (url: string, wsToken: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Drain any post-handshake stdout so the pipe buffer can't fill and block
      // the daemon's writes (the data handler early-returns once settled).
      child.stdout?.resume()
      resolve({ kind: 'spawned', baseUrl: url, wsToken, stop })
    }

    const finishDegraded = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill('SIGTERM') } catch {}
      removeHooks()
      resolve(degraded())
    }

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      if (settled) return
      stdoutBuf += chunk
      // The handshake is the FIRST line; scan complete lines only.
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (!line) continue
        const hs = parseHandshake(line)
        if (hs) { finishSpawned(hs.url, hs.wsToken); return }
        // First non-empty line wasn't a handshake -> something's wrong; degrade.
        finishDegraded()
        return
      }
    })

    // Child died before handshaking, or failed to spawn -> degrade.
    child.once('error', finishDegraded)
    child.once('exit', () => { if (!settled) finishDegraded() })
  })
}

function degraded(): DaemonHandle {
  return { kind: 'degraded', baseUrl: null, wsToken: null, stop: () => {} }
}
