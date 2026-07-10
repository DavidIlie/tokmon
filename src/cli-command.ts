import { configLocation } from './config'
import { PROVIDER_IDS, type ProviderId } from './providers/types'
import { attachOrSpawn } from './client/daemon-handle'
import { createDaemonRpcClient } from './client/daemon-rpc-client'
import { withTimeout } from './async'
import {
  buildProvidersReport,
  buildUsageReport,
  formatProvidersReport,
  formatUsageReport,
  USAGE_PERIODS,
  type UsageFilters,
  type UsagePeriod,
} from './cli-query'
import type { WebSnapshot } from './web/contract'

export type QueryCommand = 'usage' | 'models' | 'query' | 'providers' | 'snapshot' | 'config'

export interface QueryCommandDependencies {
  fetchSnapshot?: typeof fetchDaemonSnapshot
  configPath?: () => string
}

interface ParsedQueryArgs {
  help: boolean
  json: boolean
  compact: boolean
  refresh: boolean
  cached: boolean
  timeoutMs: number
  period: UsagePeriod
  provider?: ProviderId
  account?: string
  model?: string
  positionals: string[]
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

const CONFIG_HELP = `tokmon config - Print tokmon's configuration file location

Usage:
  tokmon config [path]
  tokmon config --json

Options:
      --json                    Emit { "path": "..." }
  -h, --help                    Show this help
`

function valueAfter(args: string[], index: number, name: string): [string, number] {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`)
  return [value, index + 1]
}

export function parseQueryArgs(args: string[]): ParsedQueryArgs {
  const parsed: ParsedQueryArgs = {
    help: false,
    json: false,
    compact: false,
    refresh: false,
    cached: false,
    timeoutMs: 45_000,
    period: 'month',
    positionals: [],
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') parsed.help = true
    else if (arg === '--json') parsed.json = true
    else if (arg === '--compact') parsed.compact = true
    else if (arg === '--refresh') parsed.refresh = true
    else if (arg === '--cached' || arg === '--no-refresh') parsed.cached = true
    else if (arg === '--period') {
      const [value, next] = valueAfter(args, index, '--period'); index = next
      if (!USAGE_PERIODS.includes(value as UsagePeriod)) {
        throw new Error(`--period must be one of: ${USAGE_PERIODS.join(', ')}`)
      }
      parsed.period = value as UsagePeriod
    } else if (arg.startsWith('--period=')) {
      const value = arg.slice('--period='.length)
      if (!USAGE_PERIODS.includes(value as UsagePeriod)) {
        throw new Error(`--period must be one of: ${USAGE_PERIODS.join(', ')}`)
      }
      parsed.period = value as UsagePeriod
    } else if (arg === '--provider') {
      const [value, next] = valueAfter(args, index, '--provider'); index = next
      if (!PROVIDER_IDS.includes(value as ProviderId)) throw new Error(`unknown provider: ${value}`)
      parsed.provider = value as ProviderId
    } else if (arg.startsWith('--provider=')) {
      const value = arg.slice('--provider='.length)
      if (!PROVIDER_IDS.includes(value as ProviderId)) throw new Error(`unknown provider: ${value}`)
      parsed.provider = value as ProviderId
    } else if (arg === '--account') {
      [parsed.account, index] = valueAfter(args, index, '--account')
    } else if (arg.startsWith('--account=')) {
      parsed.account = arg.slice('--account='.length)
      if (!parsed.account) throw new Error('--account requires a value')
    }
    else if (arg === '--model') {
      [parsed.model, index] = valueAfter(args, index, '--model')
    } else if (arg.startsWith('--model=')) {
      parsed.model = arg.slice('--model='.length)
      if (!parsed.model) throw new Error('--model requires a value')
    }
    else if (arg === '--timeout') {
      const [value, next] = valueAfter(args, index, '--timeout'); index = next
      const seconds = Number(value)
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) throw new Error('--timeout must be greater than 0 and at most 300 seconds')
      parsed.timeoutMs = seconds * 1_000
    } else if (arg.startsWith('--timeout=')) {
      const seconds = Number(arg.slice('--timeout='.length))
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) throw new Error('--timeout must be greater than 0 and at most 300 seconds')
      parsed.timeoutMs = seconds * 1_000
    } else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`)
    else parsed.positionals.push(arg)
  }
  if (parsed.compact) parsed.json = true
  if (parsed.refresh && parsed.cached) throw new Error('--refresh and --cached cannot be used together')
  return parsed
}

function isSnapshot(value: unknown): value is WebSnapshot {
  const snapshot = value as Partial<WebSnapshot> | null
  return !!snapshot
    && typeof snapshot.generatedAt === 'number'
    && typeof snapshot.tz === 'string'
    && Array.isArray(snapshot.accounts)
    && Array.isArray(snapshot.providers)
}

const delay = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) })

export async function fetchDaemonSnapshot(timeoutMs: number, refresh: 'table' | 'all' | null): Promise<WebSnapshot> {
  const handle = await attachOrSpawn({ timeoutMs })
  if (handle.kind !== 'spawned' || !handle.baseUrl) throw new Error('tokmon daemon is unavailable')
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
  throw new Error(`snapshot unavailable after ${timeoutMs / 1_000}s`)
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
  if (command === 'config') return CONFIG_HELP
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

  if (command === 'config') {
    const invalid = rejectsOption(args, ['--period', '--provider', '--account', '--model', '--refresh', '--cached', '--no-refresh', '--timeout'])
    if (invalid) throw new Error(`${invalid} is not valid for tokmon config`)
    if (parsed.positionals.length > 1 || (parsed.positionals[0] && parsed.positionals[0] !== 'path')) {
      throw new Error('usage: tokmon config [path] [--json]')
    }
    return parsed.json ? json({ path: getConfigPath() }, parsed.compact) : `${getConfigPath()}\n`
  }
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
