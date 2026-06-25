import { readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { cacheDir } from '../config'

export interface DaemonLock {
  pid: number
  port: number
  url: string
  wsToken?: string
  version: string
  startedAt: number
}

const lockfilePath = (): string => join(cacheDir(), 'daemon.json')

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
    mkdirSync(cacheDir(), { recursive: true, mode: 0o700 })
    const tmp = join(cacheDir(), `daemon.json.${process.pid}.tmp`)
    // 0o600: lockfile holds the wsToken credential — owner-only so other local users can't hijack the daemon.
    writeFileSync(tmp, JSON.stringify(lock), { mode: 0o600 })
    renameSync(tmp, lockfilePath())
  } catch {}
}

export function unlinkLock(): void {
  try { unlinkSync(lockfilePath()) } catch {}
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
