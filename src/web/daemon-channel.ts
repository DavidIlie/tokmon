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

/** Older daemons did not publish a channel and always occupied release. */
export function daemonChannelFromWire(value: unknown): DaemonChannel | null {
  if (value === undefined) return RELEASE_DAEMON_CHANNEL
  if (value === RELEASE_DAEMON_CHANNEL) return RELEASE_DAEMON_CHANNEL
  if (value === DEV_DAEMON_CHANNEL) return DEV_DAEMON_CHANNEL
  return null
}
