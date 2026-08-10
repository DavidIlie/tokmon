import { withTimeout } from './async'
import { attachOrSpawn } from './client/daemon-handle'
import { createDaemonRpcClient } from './client/daemon-rpc-client'
import {
  buildProvidersReport,
  buildUsageReport,
  formatProvidersReport,
  formatUsageReport,
  type UsageFilters,
} from './cli-query'
import { parseQueryArgs } from './cli-command-args'
import { configLocation } from './config'
import { PROVIDER_IDS } from './providers/types'
import type { WebSnapshot } from './web/contract'

export { parseQueryArgs, type ParsedQueryArgs } from './cli-command-args'

export type QueryCommand = 'usage' | 'models' | 'query' | 'providers' | 'snapshot'

export interface QueryCommandDependencies {
  fetchSnapshot?: typeof fetchDaemonSnapshot
  configPath?: () => string
}

const QUERY_HELP = `tokmon usage - Query model usage without opening the TUI

Usage:
  tokmon usage [options]
  tokmon models [options]       Alias for usage
  tokmon query [options]        Alias for usage

Options:
      --period <value>          today | week | month | all (default: month)
      --provider <id>           Filter by provider (${PROVIDER_IDS.join(', ')})
      --account <id-or-name>    Filter by account id, name, or email
      --model <substring>       Filter model names
      --json                    Stable machine-readable JSON (schemaVersion: 1)
      --compact                 Emit compact JSON instead of pretty JSON
      --cached                  Skip the default local-history refresh
      --refresh                 Refresh all usage and billing before reading
      --timeout <seconds>       Startup/refresh timeout (default: 45)
  -h, --help                    Show this help

Examples:
  tokmon usage
  tokmon usage --period week --provider codex
  tokmon usage --model opus --json
  tokmon usage --period all --json --compact
`

const PROVIDERS_HELP = `tokmon providers - Show detected accounts and their local data/config locations

Usage:
  tokmon providers [options]

Options:
      --json                    Stable machine-readable JSON (schemaVersion: 1)
      --compact                 Emit compact JSON instead of pretty JSON
      --refresh                 Refresh usage and billing before reading
      --timeout <seconds>       Startup/refresh timeout (default: 45)
  -h, --help                    Show this help

Examples:
  tokmon providers
  tokmon providers --json
`

const SNAPSHOT_HELP = `tokmon snapshot - Print the daemon's complete raw snapshot as JSON

Usage:
  tokmon snapshot [options]

Options:
      --refresh                 Refresh all usage and billing before reading
      --compact                 Emit compact JSON instead of pretty JSON
      --timeout <seconds>       Startup/refresh timeout (default: 45)
  -h, --help                    Show this help
`

function isSnapshot(value: unknown): value is WebSnapshot {
  const snapshot = value as Partial<WebSnapshot> | null
  return !!snapshot
    && typeof snapshot.generatedAt === 'number'
    && typeof snapshot.tz === 'string'
    && Array.isArray(snapshot.accounts)
    && Array.isArray(snapshot.providers)
}

const delay = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) })

/**
 * Compute a snapshot in this process, with no daemon.
 *
 * The singleton is shared by independently released surfaces: the desktop app
 * auto-updates while an npm-installed CLI does not, and a protocol bump between
 * them is refused by design and never recovers on its own. Refusal used to mean
 * this command produced nothing at all — exit 1, no output — which reads as a
 * broken tool rather than a version mismatch. The readers are right here, so
 * answer the question locally and say why on stderr.
 *
 * Loaded lazily: the attached path must not pay for the engine graph.
 */
async function localSnapshot(timeoutMs: number, refresh: 'table' | 'all' | null): Promise<WebSnapshot> {
  const [{ loadConfig }, { resolveEngineConfig }, { createDataEngine }, { appVersion }] = await Promise.all([
    import('./config'),
    import('./web/config-control'),
    import('./web/data-engine'),
    import('./web/static'),
  ])
  const config = await loadConfig()
  const engine = createDataEngine({
    version: appVersion(),
    config,
    ...await resolveEngineConfig(config),
  })
  try {
    // The engine hydrates from the on-disk cache when constructed, so --cached
    // can answer without touching a provider. Anything else needs a real pass.
    const cached = refresh === null ? engine.snapshot() : null
    if (cached) return cached
    await withTimeout(engine.refresh(refresh ?? 'all'), timeoutMs).catch(() => {})
    const snapshot = engine.snapshot()
    if (!snapshot) throw new Error('no usage data could be read locally')
    return snapshot
  } finally {
    engine.stop()
  }
}

export async function fetchDaemonSnapshot(timeoutMs: number, refresh: 'table' | 'all' | null): Promise<WebSnapshot> {
  const handle = await attachOrSpawn({ timeoutMs })
  if (handle.kind !== 'spawned' || !handle.baseUrl) {
    const reason = handle.issue?.message ?? 'the tokmon background service is unavailable'
    process.stderr.write(`tokmon: ${reason}\ntokmon: reading usage locally instead.\n`)
    return await localSnapshot(timeoutMs, refresh)
  }
  const deadline = Date.now() + timeoutMs

  if (refresh) {
    const client = createDaemonRpcClient(handle.baseUrl, {
      transport: 'node',
      reconnectAttempts: 2,
      reconnectBaseDelayMs: 100,
    })
    try {
      // A provider failure still leaves useful partial data in the snapshot.
      // Query commands report per-source states instead of discarding all data.
      await withTimeout(client.refresh(refresh), timeoutMs).catch(() => {})
    } finally {
      await client.close().catch(() => {})
    }
  }

  while (Date.now() < deadline) {
    try {
      const remaining = Math.max(1, deadline - Date.now())
      const response = await fetch(`${handle.baseUrl}/api/data`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(2_000, remaining)),
      })
      if (response.ok) {
        const body = await response.json() as unknown
        if (isSnapshot(body)) return body
      }
    } catch {}
    await delay(100)
  }
  // Reachable but never served a usable snapshot. Same outcome for the caller as
  // an unreachable daemon, so take the same escape hatch rather than exiting empty.
  process.stderr.write(
    `tokmon: the background service did not return data within ${timeoutMs / 1_000}s\n`
    + 'tokmon: reading usage locally instead.\n',
  )
  return await localSnapshot(timeoutMs, refresh)
}

function json(value: unknown, compact: boolean): string {
  return JSON.stringify(value, null, compact ? undefined : 2) + '\n'
}

function rejectsOption(args: string[], names: string[]): string | null {
  for (const arg of args) {
    const name = names.find(candidate => arg === candidate || arg.startsWith(`${candidate}=`))
    if (name) return name
  }
  return null
}

export function queryHelp(command: QueryCommand): string {
  if (command === 'providers') return PROVIDERS_HELP
  if (command === 'snapshot') return SNAPSHOT_HELP
  return QUERY_HELP
}

export async function runQueryCommand(
  command: QueryCommand,
  args: string[],
  dependencies: QueryCommandDependencies = {},
): Promise<string> {
  const parsed = parseQueryArgs(args)
  if (parsed.help) return queryHelp(command)
  const getConfigPath = dependencies.configPath ?? configLocation

  if (command === 'providers' || command === 'snapshot') {
    const invalid = rejectsOption(args, ['--period', '--provider', '--account', '--model', '--cached', '--no-refresh'])
    if (invalid) throw new Error(`${invalid} is only valid for tokmon usage`)
  }
  if (parsed.positionals.length) throw new Error(`unexpected argument: ${parsed.positionals[0]}`)

  const usageCommand = command === 'usage' || command === 'models' || command === 'query'
  const refresh = parsed.refresh ? 'all' : usageCommand && !parsed.cached ? 'table' : null
  const snapshot = await (dependencies.fetchSnapshot ?? fetchDaemonSnapshot)(parsed.timeoutMs, refresh)

  if (command === 'snapshot') return json(snapshot, parsed.compact)
  if (command === 'providers') {
    const report = await buildProvidersReport(snapshot, getConfigPath())
    return parsed.json ? json(report, parsed.compact) : `${formatProvidersReport(report)}\n`
  }

  const filters: UsageFilters = {
    period: parsed.period,
    provider: parsed.provider,
    account: parsed.account,
    model: parsed.model,
  }
  const report = await buildUsageReport(snapshot, filters, Date.now(), getConfigPath())
  return parsed.json ? json(report, parsed.compact) : `${formatUsageReport(report)}\n`
}
