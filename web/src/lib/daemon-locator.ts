import { daemonPortCandidates } from '../../../src/web/daemon-channel'

/**
 * A dashboard tab is bound to the origin it was served from. When the daemon
 * restarts on a different port — an app update, a lock takeover, or a tab left
 * open from a build that still used ephemeral ports — that origin is dead and
 * the RPC supervisor redials it forever with no way to learn the new address.
 * The tab has no lockfile, so the only thing it can do is look.
 *
 * The search space is exactly the range the binder can occupy, so a daemon that
 * bound successfully is always findable.
 */
const RELEASE_PORTS = daemonPortCandidates('release')
const DEV_PORTS = daemonPortCandidates('dev')

const PROBE_TIMEOUT_MS = 1_500
const PROBE_BATCH = 10

interface HealthBody {
  ok?: unknown
  version?: unknown
  protocolVersion?: unknown
}

function isTokmonHealth(body: unknown): boolean {
  const health = body as HealthBody | null
  if (!health || health.ok !== true) return false
  // Old daemons predate protocolVersion, so accept either identity marker
  // rather than navigating a tab to whatever else happens to answer on 4317.
  return typeof health.version === 'string' || typeof health.protocolVersion === 'number'
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

/**
 * Candidates in search order, current port excluded. A tab already on a dev
 * port looks at dev first; anything else (including a stale ephemeral port)
 * checks release first and still falls through to dev, so a tab left open
 * across the move to fixed ports can recover.
 */
export function candidatePorts(currentPort: number): number[] {
  const ordered = DEV_PORTS.includes(currentPort)
    ? [...DEV_PORTS, ...RELEASE_PORTS]
    : [...RELEASE_PORTS, ...DEV_PORTS]
  return ordered.filter(port => port !== currentPort)
}

export interface LocatorDeps {
  hostname: string
  protocol: string
  currentPort: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

async function probe(origin: string, deps: LocatorDeps): Promise<boolean> {
  const doFetch = deps.fetchImpl ?? fetch
  try {
    const response = await doFetch(`${origin}/healthz`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(deps.timeoutMs ?? PROBE_TIMEOUT_MS),
    })
    if (!response.ok) return false
    return isTokmonHealth(await response.json())
  } catch {
    return false
  }
}

/**
 * The origin of a live daemon on another port, or null. Only ever probes
 * loopback: with allowNetworkAccess a dashboard can be opened from another
 * machine, and port-scanning that host is not this feature's business.
 */
export async function findRelocatedDaemon(deps: LocatorDeps): Promise<string | null> {
  if (deps.protocol !== 'http:' || !isLoopbackHostname(deps.hostname)) return null
  const ports = candidatePorts(deps.currentPort)
  for (let index = 0; index < ports.length; index += PROBE_BATCH) {
    const batch = ports.slice(index, index + PROBE_BATCH)
    const results = await Promise.all(
      batch.map(async (port) => {
        const origin = `${deps.protocol}//${deps.hostname}:${port}`
        return await probe(origin, deps) ? origin : null
      }),
    )
    // Preference order within a batch is the candidate order, not whichever
    // socket answered first, so two live daemons resolve deterministically.
    const found = results.find((origin): origin is string => origin !== null)
    if (found) return found
  }
  return null
}
