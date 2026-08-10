import { spawn, type ChildProcess } from 'node:child_process'
import { extname } from 'node:path'
import { Option, Schema } from 'effect'
import { TOKMON_PROTOCOL_VERSION } from '../rpc/contract'
import {
  isAlive,
  readLock,
  readForeignLock,
  retireIncompatibleCliOwner,
  probeHealth,
  verifyLock,
  type LockfileOptions,
} from '../web/lockfile'
import { daemonChannelFromWire, resolveDaemonChannel, type DaemonChannel } from '../web/daemon-channel'
import { appVersion } from '../web/static'
import {
  classifyDaemonCompatibility,
  daemonConflictMessage,
  type DaemonOwnerIdentity,
} from '../web/daemon-compatibility'

const HANDSHAKE_TIMEOUT_MS = process.platform === 'win32' ? 15_000 : 10_000

export type DaemonKind = 'spawned' | 'degraded'

export type DaemonIssue =
  | {
      kind: 'incompatible-desktop' | 'incompatible-cli' | 'incompatible-owner'
      message: string
      ownerKind: 'cli' | 'desktop' | null
      ownerVersion: string | null
      ownerProtocolVersion: number | null
      clientProtocolVersion: number
    }
  | {
      kind: 'spawn-failed' | 'startup-exit' | 'startup-timeout'
      message: string
    }

export interface DaemonHandle {
  kind: DaemonKind
  baseUrl: string | null
  issue?: DaemonIssue
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

const HandshakeSchema = Schema.Struct({
  ready: Schema.Literal(1),
  url: Schema.String,
  port: Schema.Number,
  wsToken: Schema.String,
  version: Schema.String,
  protocolVersion: Schema.Number,
  capabilities: Schema.Array(Schema.String),
  ownerKind: Schema.Literals(['cli', 'desktop'] as const),
  // Older release daemons omitted the channel; that still means release.
  channel: Schema.optionalKey(Schema.Literals(['release', 'dev'] as const)),
})
const decodeHandshake = Schema.decodeUnknownOption(HandshakeSchema)

function parseHandshake(line: string): Handshake | null {
  try {
    const value = Option.getOrNull(decodeHandshake(JSON.parse(line)))
    if (!value) return null
    const channel = daemonChannelFromWire(value.channel)
    return channel ? { ...value, capabilities: [...value.capabilities], channel } : null
  } catch { return null }
}

function connected(url: string): DaemonHandle {
  return { kind: 'spawned', baseUrl: url, stop: () => {} }
}

async function attach(opts: LockfileOptions, protocolVersion: number): Promise<DaemonHandle | null> {
  const lock = await verifyLock(readLock(opts), protocolVersion)
  return lock ? connected(lock.url) : null
}

function incompatibleOwnerIssue(
  owner: DaemonOwnerIdentity,
  protocolVersion: number,
  options: { retirementFailed?: boolean; verificationFailed?: boolean } = {},
): DaemonIssue {
  return {
    kind: owner.ownerKind === 'desktop'
      ? 'incompatible-desktop'
      : owner.ownerKind === 'cli'
        ? 'incompatible-cli'
        : 'incompatible-owner',
    message: daemonConflictMessage(owner, {
      clientKind: 'cli',
      clientProtocolVersion: protocolVersion,
      ...options,
    }),
    ownerKind: owner.ownerKind ?? null,
    ownerVersion: owner.version ?? null,
    ownerProtocolVersion: owner.protocolVersion ?? null,
    clientProtocolVersion: protocolVersion,
  }
}

async function arbitrateIncompatibleOwner(
  opts: LockfileOptions,
  protocolVersion: number,
  timeoutMs: number,
): Promise<{ retired: boolean; issue: DaemonIssue | null }> {
  const owner = readForeignLock(opts)
  if (!owner || !isAlive(owner.pid)) return { retired: false, issue: null }
  const decision = classifyDaemonCompatibility(owner, protocolVersion)
  // Post-wake or under load a healthy daemon can exceed 500ms; a failed probe
  // here surfaces as a hard "could not be verified" error, so give the owner a
  // real budget before declaring it unverifiable.
  const verified = await probeHealth(owner.url, owner.wsToken, {
    channel: owner.channel,
    ...(owner.ownerKind ? { ownerKind: owner.ownerKind } : {}),
    ...(owner.protocolVersion === undefined ? {} : { protocolVersion: owner.protocolVersion }),
    ...(owner.version ? { version: owner.version } : {}),
  }, Math.min(2_000, timeoutMs))
  if (!verified) {
    return {
      retired: false,
      issue: incompatibleOwnerIssue(owner, protocolVersion, { verificationFailed: true }),
    }
  }
  if (decision.action !== 'retire') {
    return { retired: false, issue: incompatibleOwnerIssue(owner, protocolVersion) }
  }
  const retired = await retireIncompatibleCliOwner(opts, protocolVersion, timeoutMs)
  return retired
    ? { retired: true, issue: null }
    : {
        retired: false,
        issue: incompatibleOwnerIssue(owner, protocolVersion, { retirementFailed: true }),
      }
}

export async function attachOrSpawn(opts: AttachOrSpawnOptions = {}): Promise<DaemonHandle> {
  const protocolVersion = TOKMON_PROTOCOL_VERSION
  const timeoutMs = opts.timeoutMs ?? HANDSHAKE_TIMEOUT_MS
  const baseEnv = opts.env ?? process.env
  const channel = resolveDaemonChannel(opts.channel, baseEnv)
  const lockOpts: LockfileOptions = { cachePath: opts.cachePath, channel }

  // Same-protocol daemons from an older app release keep serving stale parsers
  // and pricing tables until something replaces them. Try a graceful upgrade
  // first; on any failure attach as before — stale data beats no data.
  const staleCandidate = readLock(lockOpts)
  if (
    staleCandidate
    && classifyDaemonCompatibility(staleCandidate, protocolVersion, appVersion()).action === 'retire'
    && staleCandidate.protocolVersion === protocolVersion
  ) {
    await retireIncompatibleCliOwner(lockOpts, protocolVersion, timeoutMs, appVersion()).catch(() => false)
  }

  const existing = await attach(lockOpts, protocolVersion)
  if (existing) return existing

  // Re-read and re-classify after retirement. A newer owner may win the lock
  // race and must never be signalled or overwritten by this older requester.
  for (let attempt = 0; attempt < 2; attempt++) {
    const arbitration = await arbitrateIncompatibleOwner(lockOpts, protocolVersion, timeoutMs)
    if (arbitration.issue) return degraded(arbitration.issue)
    if (!arbitration.retired) break
    const upgraded = await attach(lockOpts, protocolVersion)
    if (upgraded) return upgraded
  }
  const raced = await attach(lockOpts, protocolVersion)
  if (raced) return raced
  const raceArbitration = await arbitrateIncompatibleOwner(lockOpts, protocolVersion, timeoutMs)
  if (raceArbitration.issue) return degraded(raceArbitration.issue)
  if (raceArbitration.retired) {
    const replacement = await attach(lockOpts, protocolVersion)
    if (replacement) return replacement
  }

  const entry = opts.entry ?? process.argv[1]
  if (!entry) return degraded()
  const execPath = opts.execPath ?? process.execPath
  // No explicit port: the daemon takes its channel's canonical port so the
  // dashboard keeps a predictable origin across restarts. An ephemeral port
  // stranded every open browser tab the moment this daemon was replaced.
  const args = ['__daemon', '--no-open']
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
    } catch (error) {
      const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
      resolve(degraded({
        kind: 'spawn-failed',
        message: `Could not start the Tokmon background service${detail}. Check Node permissions and retry; local-only mode is active.`,
      }))
      return
    }

    let settled = false
    let stdout = ''
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let startupError: string | null = null
    let startupExit: { code: number | null; signal: NodeJS.Signals | null } | null = null
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
      if (final) {
        if (startupError) {
          finish(degraded({
            kind: 'spawn-failed',
            message: `Could not start the Tokmon background service: ${startupError}. Check Node permissions and retry; local-only mode is active.`,
          }))
        } else if (startupExit) {
          const result = startupExit.signal ? `signal ${startupExit.signal}` : `exit code ${startupExit.code ?? 'unknown'}`
          finish(degraded({
            kind: 'startup-exit',
            message: `The Tokmon background service exited before it was ready (${result}). Update or reinstall Tokmon, then retry; local-only mode is active.`,
          }))
        } else {
          finish(degraded({
            kind: 'startup-timeout',
            message: `The Tokmon background service did not become ready within ${Math.ceil(timeoutMs / 1_000)}s. Quit any stuck Tokmon process and retry; local-only mode is active.`,
          }))
        }
        return
      }
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
    child.once('error', error => {
      startupError = error.message || error.name
      tryAttach()
    })
    child.once('exit', (code, signal) => {
      startupExit = { code, signal }
      tryAttach()
    })
  })
}

function degraded(issue?: DaemonIssue): DaemonHandle {
  return { kind: 'degraded', baseUrl: null, ...(issue ? { issue } : {}), stop: () => {} }
}
