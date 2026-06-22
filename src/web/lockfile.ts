import { readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { cacheDir } from '../config'

// The daemon advertises itself here so `tokmon serve` can dedup (attach front
// door) and version-check. The TUI v1 always spawns its OWN private daemon on
// an ephemeral port and does NOT read this file — it relies on the stdout
// handshake instead. This lockfile is therefore only consulted by serve/web.
export interface DaemonLock {
  pid: number
  port: number
  url: string
  wsToken?: string
  version: string
  startedAt: number
}

export const lockfilePath = (): string => join(cacheDir(), 'daemon.json')

export function readLock(): DaemonLock | null {
  try {
    const raw = readFileSync(lockfilePath(), 'utf-8')
    const lock = JSON.parse(raw) as DaemonLock
    if (
      lock && typeof lock.pid === 'number' && typeof lock.port === 'number' &&
      typeof lock.url === 'string' && typeof lock.version === 'string'
    ) {
      if ('wsToken' in lock && typeof lock.wsToken !== 'string') delete lock.wsToken
      return lock
    }
    return null
  } catch {
    return null
  }
}

export function writeLock(lock: DaemonLock): void {
  try {
    mkdirSync(cacheDir(), { recursive: true })
    const tmp = join(cacheDir(), `daemon.json.${process.pid}.tmp`)
    writeFileSync(tmp, JSON.stringify(lock))
    renameSync(tmp, lockfilePath())
  } catch {}
}

export function unlinkLock(): void {
  try { unlinkSync(lockfilePath()) } catch {}
}

// `kill(pid, 0)` performs no signal delivery — it only validates that the pid
// exists and is signalable. ESRCH means the process is gone (stale lock).
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means it exists but we can't signal it -> still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function probeHealth(url: string, timeoutMs = 300): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/healthz`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}
