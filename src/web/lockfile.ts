import { closeSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { Effect, Option, Schema, SchemaTransformation } from 'effect'
import { cacheDir } from '../config'
import {
  daemonChannelFromWire,
  resolveDaemonChannel,
  type DaemonChannel,
} from './daemon-channel'
import { classifyDaemonCompatibility } from './daemon-compatibility'

export interface DaemonLock {
  pid: number
  port: number
  url: string
  /** Process-owner proof for lock discovery only; never sent to browsers or RPC clients. */
  wsToken: string
  /** Informational application version. Wire compatibility is protocol-based. */
  version: string
  protocolVersion: number
  capabilities: string[]
  ownerKind: 'cli' | 'desktop'
  channel: DaemonChannel
  startedAt: number
  /** Random, process-private capability used to prevent another process removing our lock. */
  ownerId: string
  state: 'starting' | 'ready'
}

export interface LockfileOptions {
  /** Test-only override. Production children inherit this through TOKMON_DAEMON_CACHE_DIR. */
  cachePath?: string
  /** Runtime namespace. Release preserves the historical lock path. */
  channel?: DaemonChannel
}

function lockDir(opts: LockfileOptions = {}): string {
  const injected = opts.cachePath ?? process.env.TOKMON_DAEMON_CACHE_DIR
  if (injected && isAbsolute(injected)) return injected
  const root = cacheDir()
  return resolveDaemonChannel(opts.channel) === 'dev' ? join(root, 'dev') : root
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

const PositiveIntegerSchema = Schema.Number.check(Schema.makeFilter<number>(
  value => Number.isInteger(value) && value > 0 ? undefined : 'expected a positive integer',
))
const PortSchema = Schema.Number.check(Schema.makeFilter<number>(
  value => Number.isInteger(value) && value >= 0 && value <= 65_535
    ? undefined
    : 'expected a valid port',
))
const ProtocolVersionSchema = Schema.Number.check(Schema.makeFilter<number>(
  value => Number.isSafeInteger(value) && value >= 1
    ? undefined
    : 'expected a positive safe integer',
))
const IntegerSchema = Schema.Number.check(Schema.makeFilter<number>(
  value => Number.isInteger(value) ? undefined : 'expected an integer',
))
const OwnerProofSchema = Schema.String.check(Schema.isMinLength(32))
const DaemonChannelSchema = Schema.Literals(['release', 'dev'] as const)
const LoopbackUrlSchema = Schema.String.check(Schema.makeFilter<string>(
  value => isLoopbackUrl(value) ? undefined : 'expected a loopback HTTP URL',
))

export const DaemonLockSchema = Schema.Struct({
  pid: PositiveIntegerSchema,
  port: PortSchema,
  url: Schema.String,
  wsToken: OwnerProofSchema,
  version: Schema.String,
  protocolVersion: ProtocolVersionSchema,
  capabilities: Schema.Array(Schema.String),
  ownerKind: Schema.Literals(['cli', 'desktop'] as const),
  // Older release daemons predate channels and occupy the release namespace.
  channel: Schema.optionalKey(DaemonChannelSchema),
  startedAt: Schema.Number,
  ownerId: OwnerProofSchema,
  state: Schema.Literals(['starting', 'ready'] as const),
}).check(Schema.makeFilter(
  lock => lock.state === 'starting' || isLoopbackUrl(lock.url)
    ? undefined
    : { path: ['url'], issue: 'expected a loopback HTTP URL for a ready lock' },
))

const ForeignDaemonLockWireSchema = Schema.Struct({
  pid: PositiveIntegerSchema,
  port: Schema.optionalKey(Schema.Unknown),
  url: LoopbackUrlSchema,
  wsToken: OwnerProofSchema,
  version: Schema.optionalKey(Schema.Unknown),
  protocolVersion: Schema.optionalKey(ProtocolVersionSchema),
  capabilities: Schema.optionalKey(Schema.Unknown),
  ownerKind: Schema.optionalKey(Schema.Literals(['cli', 'desktop'] as const)),
  channel: Schema.optionalKey(DaemonChannelSchema),
  startedAt: Schema.optionalKey(Schema.Unknown),
  ownerId: Schema.optionalKey(Schema.Unknown),
  state: Schema.Literal('ready'),
})

const ForeignDaemonLockSchema = ForeignDaemonLockWireSchema.pipe(Schema.decodeTo(
  Schema.Struct({
    pid: PositiveIntegerSchema,
    port: Schema.optionalKey(IntegerSchema),
    url: LoopbackUrlSchema,
    wsToken: OwnerProofSchema,
    version: Schema.optionalKey(Schema.String),
    protocolVersion: Schema.optionalKey(ProtocolVersionSchema),
    capabilities: Schema.optionalKey(Schema.mutable(Schema.Array(Schema.String))),
    ownerKind: Schema.optionalKey(Schema.Literals(['cli', 'desktop'] as const)),
    channel: Schema.optionalKey(DaemonChannelSchema),
    startedAt: Schema.optionalKey(Schema.Number),
    ownerId: Schema.optionalKey(Schema.String),
    state: Schema.Literal('ready'),
  }),
  SchemaTransformation.transformOrFail({
    decode: (value) => {
      const port = typeof value.port === 'number' && Number.isInteger(value.port)
        ? value.port
        : undefined
      return Effect.succeed({
        pid: value.pid,
        ...(port === undefined ? {} : { port }),
        url: value.url,
        wsToken: value.wsToken,
        ...(typeof value.version === 'string' ? { version: value.version } : {}),
        ...(value.protocolVersion === undefined ? {} : { protocolVersion: value.protocolVersion }),
        ...(Array.isArray(value.capabilities) && value.capabilities.every(item => typeof item === 'string')
          ? { capabilities: value.capabilities }
          : {}),
        ...(value.ownerKind === undefined ? {} : { ownerKind: value.ownerKind }),
        ...(value.channel === undefined ? {} : { channel: value.channel }),
        ...(typeof value.startedAt === 'number' ? { startedAt: value.startedAt } : {}),
        ...(typeof value.ownerId === 'string' ? { ownerId: value.ownerId } : {}),
        state: value.state,
      })
    },
    encode: Effect.succeed,
  }),
))

const decodeDaemonLock = Schema.decodeUnknownOption(DaemonLockSchema)
const decodeForeignDaemonLock = Schema.decodeUnknownOption(ForeignDaemonLockSchema)
const decodeAbandonedLockPid = Schema.decodeUnknownOption(Schema.Struct({
  pid: Schema.optionalKey(PositiveIntegerSchema),
}))

/** Read only owner-private, regular lock files. Legacy/insecure locks are never trusted. */
export function readLock(opts: LockfileOptions = {}): DaemonLock | null {
  try {
    const path = lockfilePath(opts)
    const stat = statSync(path)
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return null
    const parsed = Option.getOrNull(
      decodeDaemonLock(JSON.parse(readFileSync(path, 'utf-8'))),
    )
    if (!parsed) return null
    const channel = daemonChannelFromWire(parsed.channel)
    return channel === resolveDaemonChannel(opts.channel)
      ? { ...parsed, capabilities: [...parsed.capabilities], channel }
      : null
  } catch {
    return null
  }
}

export interface ForeignDaemonLock {
  pid: number
  port?: number
  url: string
  wsToken: string
  version?: string
  protocolVersion?: number
  capabilities?: string[]
  ownerKind?: DaemonLock['ownerKind']
  channel: DaemonChannel
  startedAt?: number
  ownerId?: string
  state: 'ready'
}

/**
 * Read the owner-proof fields shared with older Tokmon releases. This is only
 * for authenticated migration; callers must not treat it as a compatible lock.
 */
export function readForeignLock(opts: LockfileOptions = {}): ForeignDaemonLock | null {
  try {
    const path = lockfilePath(opts)
    const stat = statSync(path)
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return null
    const value = Option.getOrNull(
      decodeForeignDaemonLock(JSON.parse(readFileSync(path, 'utf-8'))),
    )
    if (!value) return null
    const channel = daemonChannelFromWire(value.channel)
    const { capabilities, ...foreign } = value
    return channel === resolveDaemonChannel(opts.channel)
      ? {
          ...foreign,
          ...(capabilities ? { capabilities: [...capabilities] } : {}),
          channel,
        }
      : null
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
  if (lock.channel !== resolveDaemonChannel(opts.channel)) return false
  try { ensureLockDir(opts); return writeNew(lockfilePath(opts), lock) } catch { return false }
}

/** Replace a reservation only if it is still ours. */
export function writeLock(lock: DaemonLock, opts: LockfileOptions = {}): boolean {
  const current = readLock(opts)
  if (
    !current || current.ownerId !== lock.ownerId || current.pid !== process.pid ||
    lock.channel !== current.channel
  ) return false
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
 * Reclaim an unchanged lock after its authenticated health endpoint has failed
 * for the caller's full retry window. This handles PID reuse: kill(pid, 0) can
 * only prove that *a* process exists, not that it is still the daemon which
 * wrote this owner id. Callers must probe health before using this escape hatch.
 */
export function reclaimUnhealthyLock(
  expected: DaemonLock,
  opts: LockfileOptions = {},
  minimumAgeMs = 0,
): boolean {
  const path = lockfilePath(opts)
  try {
    const before = lstatSync(path)
    if (!before.isFile()) return false
    const current = readLock(opts)
    if (
      !current
      || current.ownerId !== expected.ownerId
      || current.pid !== expected.pid
      || current.startedAt !== expected.startedAt
      || current.state !== 'ready'
      || Date.now() - current.startedAt < minimumAgeMs
    ) return false
    const after = lstatSync(path)
    if (after.dev !== before.dev || after.ino !== before.ino) return false
    unlinkSync(path)
    return true
  } catch {
    return false
  }
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
      const parsed = Option.getOrNull(
        decodeAbandonedLockPid(JSON.parse(readFileSync(path, 'utf-8'))),
      )
      if (parsed?.pid !== undefined) pid = parsed.pid
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

export interface DaemonHealthExpectation {
  version?: string
  protocolVersion?: number
  capabilities?: readonly string[]
  ownerKind?: DaemonLock['ownerKind']
  channel?: DaemonChannel
}

function sameCapabilities(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((capability, index) => capability === expected[index])
}

interface DaemonHealthBody {
  ok?: unknown
  owner?: unknown
  version?: unknown
  protocolVersion?: unknown
  capabilities?: unknown
  ownerKind?: unknown
  channel?: unknown
}

async function ownerHealth(
  url: string,
  token: string,
  timeoutMs = 500,
): Promise<DaemonHealthBody | null> {
  if (!isLoopbackUrl(url) || !token) return null
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/healthz`, {
      headers: { 'x-tokmon-token': token },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    return await res.json() as DaemonHealthBody
  } catch {
    return null
  }
}

export async function probeHealth(
  url: string,
  token: string,
  expected: DaemonHealthExpectation = {},
  timeoutMs = 500,
): Promise<boolean> {
  const body = await ownerHealth(url, token, timeoutMs)
  const bodyChannel = daemonChannelFromWire(body?.channel)
  return body !== null
      && body.ok === true
      && body.owner === true
      && (expected.version === undefined || body.version === expected.version)
      && (expected.protocolVersion === undefined || body.protocolVersion === expected.protocolVersion)
      && (expected.capabilities === undefined || sameCapabilities(body.capabilities, expected.capabilities))
      && (expected.ownerKind === undefined || body.ownerKind === expected.ownerKind)
      && (expected.channel === undefined || bodyChannel === expected.channel)
}

export async function verifyLock(
  lock: DaemonLock | null,
  protocolVersion: number,
  timeoutMs?: number,
): Promise<DaemonLock | null> {
  if (!lock || lock.state !== 'ready' || lock.protocolVersion !== protocolVersion || !isAlive(lock.pid)) return null
  return await probeHealth(lock.url, lock.wsToken, lock, timeoutMs) ? lock : null
}

const TAKEOVER_TIMEOUT_MS = 5_000
const takeoverDelay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function sameForeignOwner(left: ForeignDaemonLock, right: ForeignDaemonLock): boolean {
  return left.pid === right.pid
    && left.wsToken === right.wsToken
    && left.ownerId === right.ownerId
}

/**
 * Gracefully retire an authenticated incompatible CLI owner so either the CLI
 * or desktop host can win the normal acquisition race. Legacy locks without an
 * owner kind are accepted only when they also predate protocol metadata.
 */
export async function retireIncompatibleCliOwner(
  opts: LockfileOptions,
  protocolVersion: number,
  timeoutMs = TAKEOVER_TIMEOUT_MS,
): Promise<boolean> {
  const compatible = readLock(opts)
  if (compatible?.protocolVersion === protocolVersion) return false

  const foreign = readForeignLock(opts)
  const decision = foreign && classifyDaemonCompatibility(foreign, protocolVersion)
  if (
    !foreign || foreign.state !== 'ready' || decision?.action !== 'retire' ||
    foreign.pid === process.pid || !isAlive(foreign.pid)
  ) return false

  const health = await ownerHealth(foreign.url, foreign.wsToken, Math.min(1_000, timeoutMs))
  const healthChannel = daemonChannelFromWire(health?.channel)
  if (
    health?.ok !== true || health.owner !== true ||
    (decision.reason === 'legacy-cli'
      ? health.ownerKind !== undefined || health.protocolVersion !== undefined
      : health.ownerKind !== 'cli' || health.protocolVersion !== foreign.protocolVersion) ||
    healthChannel !== foreign.channel
  ) return false

  try { process.kill(foreign.pid, 'SIGTERM') } catch {
    if (!isAlive(foreign.pid)) {
      reclaimAbandonedLock(opts, 0)
      return true
    }
    return false
  }

  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (Date.now() < deadline) {
    const current = readForeignLock(opts)
    if (!current || !sameForeignOwner(current, foreign)) return true
    if (!isAlive(foreign.pid)) {
      reclaimAbandonedLock(opts, 0)
      return true
    }
    await takeoverDelay(50)
  }
  if (!isAlive(foreign.pid)) {
    reclaimAbandonedLock(opts, 0)
    return true
  }
  return false
}
