import { normalizeConfig, saveConfig, type Config } from '../config'
import { resolveAccounts, tzFor } from './data'
import type { DataEngine } from './data-engine'

const MIN_SUMMARY_INTERVAL_MS = 8000
const BILLING_INTERVAL_FALLBACK_MIN = 5

export const summaryIntervalFor = (config: Config): number =>
  Math.max(MIN_SUMMARY_INTERVAL_MS, (config.interval || 2) * 1000)

export const billingIntervalFor = (config: Config): number =>
  Math.max(1, config.billingInterval || BILLING_INTERVAL_FALLBACK_MIN) * 60_000

async function resolveEngineConfig(config: Config): Promise<Parameters<DataEngine['setConfig']>[0]> {
  return {
    resolved: await resolveAccounts(config),
    tz: tzFor(config),
    summaryIntervalMs: summaryIntervalFor(config),
    billingIntervalMs: billingIntervalFor(config),
  }
}

export async function applyConfigUpdate(
  engine: DataEngine,
  state: { config: Config },
  input: Config | Record<string, unknown>,
): Promise<Config> {
  const normalized = normalizeConfig(input as Record<string, unknown>)
  state.config = normalized
  await saveConfig(normalized)
  engine.setConfig(await resolveEngineConfig(normalized))
  engine.broadcastConfig(normalized)
  return normalized
}
