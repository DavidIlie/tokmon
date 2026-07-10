import { spawn, type ChildProcess } from 'node:child_process'
import { extname } from 'node:path'
import { appVersion } from '../web/static'
import { readLock, verifyLock, type LockfileOptions } from '../web/lockfile'
import { browserUrl } from '../web/open'

const HANDSHAKE_TIMEOUT_MS = process.platform === 'win32' ? 15_000 : 10_000

export type DaemonKind = 'spawned' | 'degraded'

export interface DaemonHandle {
  kind: DaemonKind
  baseUrl: string | null
  wsToken: string | null
  /** The daemon is deliberately independent of a TUI, so this only releases local client resources. */
  stop(): void
}

export interface AttachOrSpawnOptions extends LockfileOptions {
  entry?: string
  execPath?: string
  execArgv?: string[]
  timeoutMs?: number
}

// In dev (tsx), forward tsx's loader flags from process.execArgv so the child runtime matches the parent.
function runtimeExecArgv(entry: string, override?: string[]): string[] {
  if (override) return override
  const ext = extname(entry).toLowerCase()
  if (ext !== '.ts' && ext !== '.tsx' && ext !== '.mts' && ext !== '.cts') return []
  const keepFlags = ['--require', '--import', '--loader']
  const out: string[] = []
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i]
    if (arg.startsWith('--experimental-')) { out.push(arg); continue }
    const matched = keepFlags.find(flag => arg === flag || arg.startsWith(`${flag}=`))
    if (!matched) continue
    out.push(arg)
    if (arg === matched && i + 1 < process.execArgv.length) out.push(process.execArgv[++i])
  }
  return out
}

interface Handshake { ready: 1; url: string; port: number; wsToken: string; version: string }

function parseHandshake(line: string): Handshake | null {
  try {
    const value = JSON.parse(line) as Partial<Handshake>
    return value?.ready === 1 && typeof value.url === 'string' && typeof value.wsToken === 'string' && typeof value.version === 'string'
      ? value as Handshake
      : null
  } catch { return null }
}

function connected(url: string, wsToken: string): DaemonHandle {
  // Ink's existing web-toggle opens baseUrl directly. A fragment bootstraps the
  // browser without sending the capability in an HTTP request or Referer.
  return { kind: 'spawned', baseUrl: browserUrl(url, wsToken), wsToken, stop: () => {} }
}

async function attach(opts: LockfileOptions): Promise<DaemonHandle | null> {
  const lock = await verifyLock(readLock(opts), appVersion())
  return lock ? connected(lock.url, lock.wsToken) : null
}

export async function attachOrSpawn(opts: AttachOrSpawnOptions = {}): Promise<DaemonHandle> {
  const existing = await attach(opts)
  if (existing) return existing

  const entry = opts.entry ?? process.argv[1]
  if (!entry) return degraded()
  const execPath = opts.execPath ?? process.execPath
  const timeoutMs = opts.timeoutMs ?? HANDSHAKE_TIMEOUT_MS
  const args = ['__daemon', '--port', '0', '--no-open']
  const env = opts.cachePath ? { ...process.env, TOKMON_DAEMON_CACHE_DIR: opts.cachePath } : process.env

  return new Promise<DaemonHandle>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(execPath, [...runtimeExecArgv(entry, opts.execArgv), entry, ...args], {
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: process.platform !== 'win32',
        env,
      })
    } catch { resolve(degraded()); return }

    let settled = false
    let stdout = ''
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    const finish = (handle: DaemonHandle) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (pollTimer) clearTimeout(pollTimer)
      child.stdout?.destroy()
      // Detached daemon lifetime belongs to its lock, not this TUI process.
      child.unref()
      resolve(handle)
    }
    const tryAttach = (final = false) => { void attach(opts).then(found => {
      if (found) { finish(found); return }
      if (final) { finish(degraded()); return }
      if (!settled && !pollTimer) {
        pollTimer = setTimeout(() => {
          pollTimer = null
          tryAttach()
        }, 100)
      }
    }) }
    // Keep this timer referenced: if a losing race child exits, its caller must
    // remain alive long enough to attach to the winner instead of exiting mid-await.
    const timer = setTimeout(() => tryAttach(true), timeoutMs)

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      let newline: number
      while ((newline = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, newline).trim()
        stdout = stdout.slice(newline + 1)
        const handshake = parseHandshake(line)
        if (!handshake || handshake.version !== appVersion()) continue
        // A handshake alone is not authority. Re-read the owner-only lock and health-check it.
        tryAttach()
        return
      }
    })
    child.once('error', () => tryAttach())
    child.once('exit', () => tryAttach())
  })
}

function degraded(): DaemonHandle {
  return { kind: 'degraded', baseUrl: null, wsToken: null, stop: () => {} }
}
