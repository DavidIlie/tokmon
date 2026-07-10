import { closeSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { cacheDir } from '../config'

export interface DaemonLock {
  pid: number
  port: number
  url: string
  /** Process-owner proof for lock discovery only; never sent to browsers or RPC clients. */
  wsToken: string
  version: string
  startedAt: number
  /** Random, process-private capability used to prevent another process removing our lock. */
  ownerId: string
  state: 'starting' | 'ready'
}

export interface LockfileOptions {
  /** Test-only override. Production children inherit this through TOKMON_DAEMON_CACHE_DIR. */
  cachePath?: string
}

function lockDir(opts: LockfileOptions = {}): string {
  const injected = opts.cachePath ?? process.env.TOKMON_DAEMON_CACHE_DIR
  return injected && isAbsolute(injected) ? injected : cacheDir()
}

export function lockfilePath(opts: LockfileOptions = {}): string {
  return join(lockDir(opts), 'daemon.json')
}

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
  } catch {
    return false
  }
}

function validLock(value: unknown): value is DaemonLock {
  const lock = value as Partial<DaemonLock> | null
  return !!lock
    && typeof lock.pid === 'number' && Number.isInteger(lock.pid) && lock.pid > 0
    && typeof lock.port === 'number' && Number.isInteger(lock.port) && lock.port >= 0 && lock.port <= 65535
    && typeof lock.url === 'string' && (lock.state === 'starting' || isLoopbackUrl(lock.url))
    && typeof lock.wsToken === 'string' && lock.wsToken.length >= 32
    && typeof lock.version === 'string'
    && typeof lock.startedAt === 'number'
    && typeof lock.ownerId === 'string' && lock.ownerId.length >= 32
    && (lock.state === 'starting' || lock.state === 'ready')
}

/** Read only owner-private, regular lock files. Legacy/insecure locks are never trusted. */
export function readLock(opts: LockfileOptions = {}): DaemonLock | null {
  try {
    const path = lockfilePath(opts)
    const stat = statSync(path)
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return null
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return validLock(parsed) ? parsed : null
  } catch {
    return null
  }
}

function ensureLockDir(opts: LockfileOptions): void {
  const dir = lockDir(opts)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  let fd: number | undefined
  try { fd = openSync(dir, 'r'); fchmodSync(fd, 0o700) } catch {} finally { if (fd !== undefined) try { closeSync(fd) } catch {} }
}

function writeNew(path: string, lock: DaemonLock): boolean {
  let fd: number | undefined
  let created = false
  try {
    fd = openSync(path, 'wx', 0o600)
    created = true
    fchmodSync(fd, 0o600)
    writeFileSync(fd, JSON.stringify(lock))
    fsyncSync(fd)
    return true
  } catch {
    // Only remove a partial file created by this call. EEXIST belongs to the
    // winning owner and must never be unlinked here.
    if (created) try { unlinkSync(path) } catch {}
    return false
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch {}
  }
}

/** Atomically reserve the singleton lock. It never overwrites an existing owner. */
export function acquireLock(lock: DaemonLock, opts: LockfileOptions = {}): boolean {
  try { ensureLockDir(opts); return writeNew(lockfilePath(opts), lock) } catch { return false }
}

/** Replace a reservation only if it is still ours. */
export function writeLock(lock: DaemonLock, opts: LockfileOptions = {}): boolean {
  const current = readLock(opts)
  if (!current || current.ownerId !== lock.ownerId || current.pid !== process.pid) return false
  const path = lockfilePath(opts)
  const tmp = join(lockDir(opts), `daemon.json.${process.pid}.${lock.ownerId}.tmp`)
  let fd: number | undefined
  try {
    writeFileSync(tmp, JSON.stringify(lock), { mode: 0o600 })
    try { fd = openSync(tmp, 'r'); fchmodSync(fd, 0o600); fsyncSync(fd) } catch {}
    renameSync(tmp, path)
    return true
  } catch {
    try { unlinkSync(tmp) } catch {}
    return false
  } finally { if (fd !== undefined) try { closeSync(fd) } catch {} }
}

/** Normal shutdown cleanup. A process can only remove the exact lock it owns. */
export function unlinkLock(ownerId: string, opts: LockfileOptions = {}): boolean {
  const current = readLock(opts)
  if (!current || current.ownerId !== ownerId || current.pid !== process.pid) return false
  try { unlinkSync(lockfilePath(opts)); return true } catch { return false }
}

/** A dead process cannot clean up; reclaim only after its pid has been proven dead. */
export function reclaimDeadLock(opts: LockfileOptions = {}): boolean {
  const current = readLock(opts)
  if (!current || isAlive(current.pid)) return false
  try { unlinkSync(lockfilePath(opts)); return true } catch { return false }
}

/**
 * Reclaim malformed/legacy leftovers without racing an active acquisition.
 * A parseable live pid always wins. Ownerless partials need an age grace period,
 * and the inode is checked again before unlinking so a successor cannot be lost.
 */
export function reclaimAbandonedLock(opts: LockfileOptions = {}, graceMs = 10_000): boolean {
  const path = lockfilePath(opts)
  try {
    const before = lstatSync(path)
    if (!before.isFile()) return false

    let pid: number | null = null
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { pid?: unknown }
      if (Number.isInteger(parsed.pid) && (parsed.pid as number) > 0) pid = parsed.pid as number
    } catch {}

    if (pid !== null && isAlive(pid)) return false
    if (pid === null && Date.now() - before.mtimeMs < graceMs) return false

    const after = lstatSync(path)
    if (after.dev !== before.dev || after.ino !== before.ino) return false
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

// kill(pid, 0) validates the pid exists without delivering a signal; EPERM means alive but unsignalable.
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function probeHealth(url: string, token: string, version?: string, timeoutMs = 500): Promise<boolean> {
  if (!isLoopbackUrl(url) || !token) return false
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/healthz`, {
      headers: { 'x-tokmon-token': token },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return false
    const body = await res.json() as { ok?: unknown; owner?: unknown; version?: unknown }
    return body.ok === true && body.owner === true && (version === undefined || body.version === version)
  } catch {
    return false
  }
}

export async function verifyLock(lock: DaemonLock | null, version: string, timeoutMs?: number): Promise<DaemonLock | null> {
  if (!lock || lock.state !== 'ready' || lock.version !== version || !isAlive(lock.pid)) return null
  return await probeHealth(lock.url, lock.wsToken, version, timeoutMs) ? lock : null
}
