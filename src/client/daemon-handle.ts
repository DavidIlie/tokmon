import { spawn, type ChildProcess } from 'node:child_process'
import { extname } from 'node:path'
import { TOKMON_PROTOCOL_VERSION } from '../rpc/contract'
import {
  readLock,
  retireIncompatibleCliOwner,
  verifyLock,
  type LockfileOptions,
} from '../web/lockfile'
import { daemonChannelFromWire, resolveDaemonChannel, type DaemonChannel } from '../web/daemon-channel'

const HANDSHAKE_TIMEOUT_MS = process.platform === 'win32' ? 15_000 : 10_000

export type DaemonKind = 'spawned' | 'degraded'

export interface DaemonHandle {
  kind: DaemonKind
  baseUrl: string | null
  /** The daemon is deliberately independent of a TUI, so this only releases local client resources. */
  stop(): void
}

export interface AttachOrSpawnOptions extends LockfileOptions {
  entry?: string
  execPath?: string
  execArgv?: string[]
  /** Test-only environment override for the spawned daemon. */
  env?: NodeJS.ProcessEnv
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

interface Handshake {
  ready: 1
  url: string
  port: number
  wsToken: string
  version: string
  protocolVersion: number
  capabilities: string[]
  ownerKind: 'cli' | 'desktop'
  channel: DaemonChannel
}

function parseHandshake(line: string): Handshake | null {
  try {
    const value = JSON.parse(line) as Partial<Handshake>
    return value?.ready === 1
      && typeof value.url === 'string'
      && typeof value.wsToken === 'string'
      && typeof value.version === 'string'
      && typeof value.protocolVersion === 'number'
      && Array.isArray(value.capabilities)
      && value.capabilities.every(capability => typeof capability === 'string')
      && (value.ownerKind === 'cli' || value.ownerKind === 'desktop')
      && daemonChannelFromWire(value.channel) !== null
      ? { ...value, channel: daemonChannelFromWire(value.channel) } as Handshake
      : null
  } catch { return null }
}

function connected(url: string): DaemonHandle {
  return { kind: 'spawned', baseUrl: url, stop: () => {} }
}

async function attach(opts: LockfileOptions, protocolVersion: number): Promise<DaemonHandle | null> {
  const lock = await verifyLock(readLock(opts), protocolVersion)
  return lock ? connected(lock.url) : null
}

export async function attachOrSpawn(opts: AttachOrSpawnOptions = {}): Promise<DaemonHandle> {
  const protocolVersion = TOKMON_PROTOCOL_VERSION
  const timeoutMs = opts.timeoutMs ?? HANDSHAKE_TIMEOUT_MS
  const baseEnv = opts.env ?? process.env
  const channel = resolveDaemonChannel(opts.channel, baseEnv)
  const lockOpts: LockfileOptions = { cachePath: opts.cachePath, channel }
  const existing = await attach(lockOpts, protocolVersion)
  if (existing) return existing

  await retireIncompatibleCliOwner(lockOpts, protocolVersion, timeoutMs)
  const upgraded = await attach(lockOpts, protocolVersion)
  if (upgraded) return upgraded

  const entry = opts.entry ?? process.argv[1]
  if (!entry) return degraded()
  const execPath = opts.execPath ?? process.execPath
  const args = ['__daemon', '--port', '0', '--no-open']
  const env = {
    ...baseEnv,
    TOKMON_CHANNEL: channel,
    ...(opts.cachePath ? { TOKMON_DAEMON_CACHE_DIR: opts.cachePath } : {}),
  }

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
    const tryAttach = (final = false) => { void attach(lockOpts, protocolVersion).then(found => {
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
        if (!handshake || handshake.protocolVersion !== protocolVersion || handshake.channel !== channel) continue
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
  return { kind: 'degraded', baseUrl: null, stop: () => {} }
}
