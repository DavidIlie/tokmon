import { normalizeConfig, saveConfig, type Config } from '../config'
import {
  TOKMON_CAPABILITIES,
  TOKMON_PROTOCOL_VERSION,
  type ConfigState,
  type ConfigUpdateRequest,
} from '../rpc/contract'
import { resolveAccounts, tzFor } from './data'
import type { DataEngine } from './data-engine'

const MIN_SUMMARY_INTERVAL_MS = 8000
const BILLING_INTERVAL_FALLBACK_MIN = 5

export const summaryIntervalFor = (config: Config): number =>
  Math.max(MIN_SUMMARY_INTERVAL_MS, (config.interval || 2) * 1000)

export const billingIntervalFor = (config: Config): number =>
  Math.max(1, config.billingInterval || BILLING_INTERVAL_FALLBACK_MIN) * 60_000

export function toConfigState(config: Config): ConfigState {
  return {
    protocol: {
      version: TOKMON_PROTOCOL_VERSION,
      capabilities: [...TOKMON_CAPABILITIES],
    },
    config,
  }
}

export class ConfigConflictError extends Error {
  readonly kind = 'conflict' as const

  constructor(readonly state: ConfigState) {
    super(`config changed on the daemon (current revision ${state.config.revision})`)
    this.name = 'ConfigConflictError'
  }
}

export class ConfigPersistenceError extends Error {
  readonly kind = 'persistence' as const

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'config could not be persisted')
    this.name = 'ConfigPersistenceError'
    this.cause = cause
  }
}

async function resolveEngineConfig(config: Config): Promise<Parameters<DataEngine['setConfig']>[0]> {
  return {
    resolved: await resolveAccounts(config),
    tz: tzFor(config),
    summaryIntervalMs: summaryIntervalFor(config),
    billingIntervalMs: billingIntervalFor(config),
  }
}

/** Fields consumed by DataEngine. Everything else is a hot presentation preference. */
export function configAffectsEngine(previous: Config, next: Config): boolean {
  return previous.interval !== next.interval
    || previous.billingInterval !== next.billingInterval
    || previous.timezone !== next.timezone
    || JSON.stringify(previous.accounts) !== JSON.stringify(next.accounts)
    || JSON.stringify(previous.disabledProviders) !== JSON.stringify(next.disabledProviders)
    || JSON.stringify(previous.accountDetection) !== JSON.stringify(next.accountDetection)
}

// RPC handlers may run concurrently. The revision check and durable write must
// be one serialized operation or two callers can both validate the same
// revision before either one advances state.
const updateQueues = new WeakMap<object, Promise<void>>()

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/** Preserve capability-gated fields an older full-document client cannot know. */
function mergeCapabilityFields(incomingConfig: Config, current: Config): Record<string, unknown> {
  const incoming = incomingConfig as Partial<Config>
  const incomingTray = incoming.tray as Partial<Config['tray']> | undefined
  const incomingDesktop = incoming.desktop as Partial<Config['desktop']> | undefined

  return {
    ...incoming,
    appearance: hasOwn(incoming, 'appearance') ? incoming.appearance : current.appearance,
    accountDetection: hasOwn(incoming, 'accountDetection')
      ? incoming.accountDetection
      : current.accountDetection,
    tray: hasOwn(incoming, 'tray') && incomingTray
      ? {
          ...current.tray,
          ...incomingTray,
          pinnedProviders: hasOwn(incomingTray, 'pinnedProviders')
            ? incomingTray.pinnedProviders
            : current.tray.pinnedProviders,
        }
      : current.tray,
    desktop: hasOwn(incoming, 'desktop') && incomingDesktop
      ? {
          ...current.desktop,
          ...incomingDesktop,
          expandedProviders: hasOwn(incomingDesktop, 'expandedProviders')
            ? incomingDesktop.expandedProviders
            : current.desktop.expandedProviders,
          graphRangeDays: hasOwn(incomingDesktop, 'graphRangeDays')
            ? incomingDesktop.graphRangeDays
            : current.desktop.graphRangeDays,
        }
      : current.desktop,
  }
}

async function applyConfigUpdateUnlocked(
  engine: DataEngine,
  state: { config: Config },
  input: ConfigUpdateRequest,
): Promise<ConfigState> {
  if (input.expectedRevision !== state.config.revision) {
    throw new ConfigConflictError(toConfigState(state.config))
  }

  const normalized = normalizeConfig({
    ...mergeCapabilityFields(input.config, state.config),
    revision: state.config.revision + 1,
  })

  const reconfigureEngine = configAffectsEngine(state.config, normalized)
  // Only source/timing changes resolve accounts. Pins, privacy, disclosure and
  // summary preferences are durable hot updates and must never restart fetches.
  const engineConfig = reconfigureEngine ? await resolveEngineConfig(normalized) : null
  try {
    await saveConfig(normalized)
  } catch (error) {
    throw new ConfigPersistenceError(error)
  }

  state.config = normalized
  if (engineConfig) engine.setConfig(engineConfig)
  engine.broadcastConfig(normalized)
  return toConfigState(normalized)
}

/**
 * The daemon's transactional config boundary. Persistence completes before the
 * in-memory state, engine and subscriber stream change, so a failed write can
 * never be announced as a successful configuration update.
 */
export async function applyConfigUpdate(
  engine: DataEngine,
  state: { config: Config },
  input: ConfigUpdateRequest,
): Promise<ConfigState> {
  const previous = updateQueues.get(state) ?? Promise.resolve()
  const operation = previous
    .catch(() => undefined)
    .then(() => applyConfigUpdateUnlocked(engine, state, input))
  const settled = operation.then(() => undefined, () => undefined)
  updateQueues.set(state, settled)
  void settled.then(() => {
    if (updateQueues.get(state) === settled) updateQueues.delete(state)
  })
  return operation
}
