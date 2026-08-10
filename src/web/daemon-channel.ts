export type DaemonChannel = 'release' | 'dev'

export const RELEASE_DAEMON_CHANNEL: DaemonChannel = 'release'
export const DEV_DAEMON_CHANNEL: DaemonChannel = 'dev'

/**
 * Resolve the runtime channel shared by the CLI and desktop host. Release keeps
 * the historical singleton namespace; development is deliberately isolated.
 */
export function resolveDaemonChannel(
  explicit?: DaemonChannel,
  env: NodeJS.ProcessEnv = process.env,
): DaemonChannel {
  if (explicit) return explicit
  const configured = env.TOKMON_CHANNEL
    ?? env.TOKMON_RUNTIME_CHANNEL
    ?? env.TOKMON_RUNTIME_TAG
  return configured === DEV_DAEMON_CHANNEL ? DEV_DAEMON_CHANNEL : RELEASE_DAEMON_CHANNEL
}

/**
 * The dashboard is a browser tab, so the daemon's address is part of its public
 * contract: a tab can only reconnect to an origin it can predict. Binding an
 * ephemeral port made every daemon restart orphan every open tab permanently —
 * the tab has no lockfile and no way to learn the new port. So each channel owns
 * a fixed, small port range instead.
 *
 * The span is deliberately shared by the binder and the browser's recovery scan.
 * If the binder could land outside the range the browser scans, a tab would
 * still be able to end up stranded, which is the whole bug.
 */
const DAEMON_PORT_BASE: Record<DaemonChannel, number> = {
  release: 4317,
  dev: 4417,
}
export const DAEMON_PORT_SPAN = 10

export function daemonPortBase(channel: DaemonChannel): number {
  return DAEMON_PORT_BASE[channel]
}

/** Every port a daemon on this channel may occupy, in bind-preference order. */
export function daemonPortCandidates(channel: DaemonChannel): number[] {
  const base = daemonPortBase(channel)
  return Array.from({ length: DAEMON_PORT_SPAN }, (_, offset) => base + offset)
}

/** Older daemons did not publish a channel and always occupied release. */
export function daemonChannelFromWire(value: unknown): DaemonChannel | null {
  if (value === undefined) return RELEASE_DAEMON_CHANNEL
  if (value === RELEASE_DAEMON_CHANNEL) return RELEASE_DAEMON_CHANNEL
  if (value === DEV_DAEMON_CHANNEL) return DEV_DAEMON_CHANNEL
  return null
}
