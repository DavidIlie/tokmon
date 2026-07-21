import { randomBytes } from 'node:crypto'
import { loadConfig, type Config } from '../config'
import { flushDisk } from '../providers/usage-core'
import { TOKMON_CAPABILITIES, TOKMON_PROTOCOL_VERSION } from '../rpc/contract'
import { startWebServer, type WebServerController } from './server'
import { appVersion } from './static'
import {
  acquireLock,
  isAlive,
  lockfilePath,
  readLock,
  reclaimAbandonedLock,
  reclaimDeadLock,
  reclaimUnhealthyLock,
  readForeignLock,
  retireIncompatibleCliOwner,
  unlinkLock,
  verifyLock,
  writeLock,
  type DaemonLock,
  type LockfileOptions,
} from './lockfile'
import { resolveDaemonChannel } from './daemon-channel'
import {
  classifyDaemonCompatibility,
  daemonConflictMessage,
  type DaemonOwnerIdentity,
} from './daemon-compatibility'

const OWNER_WAIT_ATTEMPTS = 60
const OWNER_WAIT_INTERVAL_MS = 50
const OWNER_VERIFY_TIMEOUT_MS = 250
const OWNER_TAKEOVER_TIMEOUT_MS = 5_000

interface LocalOwner {
  lock: DaemonLock
  stopping: boolean
}

const localOwners = new Map<string, LocalOwner>()

export interface AcquireOrAttachDaemonOptions extends LockfileOptions {
  ownerKind: DaemonLock['ownerKind']
  port?: number
  log?: boolean
  /** Explicit packaged dashboard directory for embedded hosts such as Electron. */
  webRoot?: string
  /** Explicit host version for bundled embedders such as Electron. */
  version?: string
  /** Primarily useful for deterministic embedding/tests. Defaults to the persisted config. */
  config?: Config
  protocolVersion?: number
  capabilities?: readonly string[]
  ownerWaitAttempts?: number
  ownerWaitIntervalMs?: number
  ownerVerifyTimeoutMs?: number
  ownerTakeoverTimeoutMs?: number
  /** Test-only synchronization hook for deterministic reservation-race coverage. */
  beforeReserve?: () => void | Promise<void>
}

export interface DaemonController {
  role: 'owner' | 'attached'
  baseUrl: string
  lock: DaemonLock
  /** Present only when this process started the data engine. */
  config: Config | null
  /** Attached controllers release nothing. Owner shutdown is idempotent. */
  stop(): Promise<void>
}

export class DaemonOwnerUnavailableError extends Error {
  readonly owner: DaemonOwnerIdentity | null
  readonly clientProtocolVersion: number | null

  constructor(
    message: string,
    owner: DaemonOwnerIdentity | null = null,
    clientProtocolVersion: number | null = null,
  ) {
    super(message)
    this.name = 'DaemonOwnerUnavailableError'
    this.owner = owner
    this.clientProtocolVersion = clientProtocolVersion
  }
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function localOwnerFor(
  opts: AcquireOrAttachDaemonOptions,
  protocolVersion: number,
): DaemonLock | null {
  const owner = localOwners.get(lockfilePath(opts))
  if (owner?.stopping) {
    throw new DaemonOwnerUnavailableError('the in-process daemon owner is shutting down')
  }
  return owner && owner.lock.protocolVersion === protocolVersion
    ? owner.lock
    : null
}

function attached(lock: DaemonLock): DaemonController {
  return {
    role: 'attached',
    baseUrl: lock.url,
    lock,
    config: null,
    stop: async () => {},
  }
}

async function waitForOwner(
  opts: AcquireOrAttachDaemonOptions,
  protocolVersion: number,
): Promise<DaemonLock | null> {
  const attempts = opts.ownerWaitAttempts ?? OWNER_WAIT_ATTEMPTS
  const intervalMs = opts.ownerWaitIntervalMs ?? OWNER_WAIT_INTERVAL_MS
  const verifyTimeoutMs = opts.ownerVerifyTimeoutMs ?? OWNER_VERIFY_TIMEOUT_MS
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (intervalMs > 0) await delay(intervalMs)
    const local = localOwnerFor(opts, protocolVersion)
    if (local) return local
    const current = readLock(opts)
    const winner = await verifyLock(current, protocolVersion, verifyTimeoutMs)
    if (winner) return winner
    if (!current || !isAlive(current.pid)) return null
    if (current.protocolVersion !== protocolVersion) return null
  }
  return null
}

function incompatibleOwnerError(
  owner: DaemonOwnerIdentity,
  opts: AcquireOrAttachDaemonOptions,
  protocolVersion: number,
  retirementFailed = false,
): DaemonOwnerUnavailableError {
  return new DaemonOwnerUnavailableError(
    daemonConflictMessage(owner, {
      clientKind: opts.ownerKind,
      clientProtocolVersion: protocolVersion,
      retirementFailed,
    }),
    owner,
    protocolVersion,
  )
}

async function retireOrRefuseOwner(
  owner: DaemonOwnerIdentity,
  opts: AcquireOrAttachDaemonOptions,
  protocolVersion: number,
): Promise<void> {
  const decision = classifyDaemonCompatibility(owner, protocolVersion)
  if (decision.action !== 'retire') {
    throw incompatibleOwnerError(owner, opts, protocolVersion)
  }
  const retired = await retireIncompatibleCliOwner(
    opts,
    protocolVersion,
    opts.ownerTakeoverTimeoutMs ?? OWNER_TAKEOVER_TIMEOUT_MS,
  )
  if (!retired) {
    throw incompatibleOwnerError(owner, opts, protocolVersion, true)
  }
}

async function discoverOwner(
  opts: AcquireOrAttachDaemonOptions,
  protocolVersion: number,
): Promise<DaemonLock | null> {
  const local = localOwnerFor(opts, protocolVersion)
  if (local) return local
  let current = readLock(opts)
  if (!current && reclaimAbandonedLock(opts)) current = readLock(opts)

  const live = await verifyLock(current, protocolVersion)
  if (live) return live

  // A crashed owner can leave a valid lock whose PID has since been reused by
  // an unrelated process. Give a same-protocol ready daemon the complete
  // recovery window, then reclaim only the exact unchanged owner record. Never
  // signal the process: it has not authenticated as the daemon in the lock.
  if (
    current?.state === 'ready'
    && current.protocolVersion === protocolVersion
    && isAlive(current.pid)
  ) {
    const winner = await waitForOwner(opts, protocolVersion)
    if (winner) return winner
    if (reclaimUnhealthyLock(current, opts)) return null
    current = readLock(opts)
  }

  if (
    current?.state === 'starting'
    && current.protocolVersion === protocolVersion
    && isAlive(current.pid)
  ) {
    const winner = await waitForOwner(opts, protocolVersion)
    if (winner) return winner
    current = readLock(opts)
  }

  if (current && isAlive(current.pid)) {
    await retireOrRefuseOwner(current, opts, protocolVersion)
    return null
  }
  if (current) reclaimDeadLock(opts)
  const foreign = readForeignLock(opts)
  if (foreign && isAlive(foreign.pid)) {
    await retireOrRefuseOwner(foreign, opts, protocolVersion)
    return null
  }
  return null
}

function reservationFor(
  opts: AcquireOrAttachDaemonOptions,
  version: string,
  protocolVersion: number,
  capabilities: readonly string[],
): DaemonLock {
  return {
    pid: process.pid,
    port: 0,
    url: '',
    wsToken: randomBytes(32).toString('base64url'),
    version,
    protocolVersion,
    capabilities: [...capabilities],
    ownerKind: opts.ownerKind,
    channel: resolveDaemonChannel(opts.channel),
    startedAt: Date.now(),
    ownerId: randomBytes(32).toString('base64url'),
    state: 'starting',
  }
}

async function reserveOwnership(
  opts: AcquireOrAttachDaemonOptions,
  reservation: DaemonLock,
): Promise<DaemonLock | null> {
  // Re-classify after each lost reservation race. In particular, an older
  // requester must never retire a newer CLI which appeared after discovery.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (acquireLock(reservation, opts)) return null
    const winner = await waitForOwner(opts, reservation.protocolVersion)
    if (winner) return winner

    const current = readLock(opts)
    if (current && isAlive(current.pid)) {
      await retireOrRefuseOwner(current, opts, reservation.protocolVersion)
      continue
    }
    if (current) reclaimDeadLock(opts)

    const foreign = readForeignLock(opts)
    if (foreign && isAlive(foreign.pid)) {
      await retireOrRefuseOwner(foreign, opts, reservation.protocolVersion)
      continue
    }
    reclaimAbandonedLock(opts, 0)
  }
  throw new DaemonOwnerUnavailableError('daemon startup is already in progress')
}

function owned(
  opts: AcquireOrAttachDaemonOptions,
  lock: DaemonLock,
  config: Config,
  server: WebServerController,
): DaemonController {
  let stopPromise: Promise<void> | null = null
  const owner: LocalOwner = { lock, stopping: false }
  const ownerKey = lockfilePath(opts)
  localOwners.set(ownerKey, owner)
  return {
    role: 'owner',
    baseUrl: lock.url,
    lock,
    config,
    stop: () => {
      stopPromise ??= (async () => {
        owner.stopping = true
        try { await server.stop() } catch {}
        await flushDisk().catch(() => {})
        unlinkLock(lock.ownerId, opts)
        if (localOwners.get(ownerKey) === owner) localOwners.delete(ownerKey)
      })()
      return stopPromise
    },
  }
}

/**
 * Attaches to the compatible singleton or starts it in this process. This owns
 * no process signals or exit policy, so Electron and the CLI can each provide
 * the lifecycle appropriate to their host.
 */
export async function acquireOrAttachDaemon(
  opts: AcquireOrAttachDaemonOptions,
): Promise<DaemonController> {
  const protocolVersion = opts.protocolVersion ?? TOKMON_PROTOCOL_VERSION
  const capabilities = opts.capabilities ?? TOKMON_CAPABILITIES
  const existing = await discoverOwner(opts, protocolVersion)
  if (existing) return attached(existing)

  const reservation = reservationFor(
    opts,
    opts.version ?? appVersion(),
    protocolVersion,
    capabilities,
  )
  await opts.beforeReserve?.()
  const winner = await reserveOwnership(opts, reservation)
  if (winner) return attached(winner)

  let server: WebServerController | null = null
  try {
    const config = opts.config ?? await loadConfig()
    server = await startWebServer({
      config,
      port: opts.port,
      log: opts.log,
      webRoot: opts.webRoot,
      version: reservation.version,
      wsToken: reservation.wsToken,
      ownerKind: reservation.ownerKind,
      channel: reservation.channel,
      protocolVersion: reservation.protocolVersion,
      capabilities: reservation.capabilities,
    })
    const ready: DaemonLock = {
      ...reservation,
      port: server.port,
      url: server.url,
      state: 'ready',
    }
    if (!writeLock(ready, opts)) throw new Error('lost daemon lock ownership during startup')
    return owned(opts, ready, config, server)
  } catch (error) {
    try { await server?.stop() } catch {}
    unlinkLock(reservation.ownerId, opts)
    throw error
  }
}
