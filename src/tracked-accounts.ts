// Node-free tracked-account projection shared by every settings surface.

import { PROVIDER_META, PROVIDER_ORDER } from './provider-meta'
import type { Config, DetectedAccountRef } from './config-schema'
import type { ProviderId } from './providers/types'

export type TrackedAccountSource = 'auto' | 'configured' | 'ignored'

export interface TrackedAccountRow {
  id: string
  providerId: ProviderId
  name: string
  homeDir: string
  color: string
  source: TrackedAccountSource
  enabled: boolean
  explicitId?: string
  explicitIndex?: number
  excludedRef?: DetectedAccountRef
  /**
   * For a removed row: whether the home it suppresses was still found. `true`
   * means restoring brings an account back; `false` means the source is gone
   * and only the tombstone itself can be cleared. Undefined when the daemon
   * predates `suppressedAccounts` and liveness is simply unknown.
   */
  live?: boolean
}

export interface TrackedAccountCandidate {
  id: string
  providerId: ProviderId
  name: string
  homeDir?: string | null
  color?: string | null
  source?: 'auto' | 'configured'
}

export function getTrackedAccountRows(
  config: Config,
  trackedProviders: readonly ProviderId[] = PROVIDER_ORDER.filter(pid => !config.disabledProviders.includes(pid)),
  autoAccounts?: readonly TrackedAccountCandidate[],
  suppressedAccounts?: readonly DetectedAccountRef[],
): TrackedAccountRow[] {
  const tracked = new Set(trackedProviders)
  const configuredIds = new Set<string>()
  const configuredKeys = new Set<string>()
  const rowIds = new Set<string>()
  const rowKeys = new Set<string>()
  const rows: TrackedAccountRow[] = []
  const detectionEnabled = config.accountDetection.enabled
  const detectorDisabled = new Set(config.accountDetection.disabledProviders)

  const keyFor = (providerId: ProviderId, homeDir?: string | null) =>
    `${providerId}:${homeDir && homeDir !== '~' ? homeDir : '~'}`
  const excludedKeys = new Set(
    config.accountDetection.excludedAccounts.map(ref => keyFor(ref.providerId, ref.homeDir)),
  )
  const liveById = new Map((autoAccounts ?? []).map(account => [account.id, account]))

  const rememberRow = (row: TrackedAccountRow): void => {
    rowIds.add(row.id)
    rowKeys.add(keyFor(row.providerId, row.homeDir))
    rows.push(row)
  }

  config.accounts.forEach((account, explicitIndex) => {
    const meta = PROVIDER_META[account.providerId]
    configuredIds.add(account.id)
    configuredKeys.add(keyFor(account.providerId, account.homeDir))
    const live = liveById.get(account.id)
    if (live) {
      configuredKeys.add(keyFor(account.providerId, live.homeDir))
    }
    rememberRow({
      id: account.id,
      providerId: account.providerId,
      name: account.name,
      homeDir: account.homeDir || '~',
      color: account.color || meta.color,
      source: 'configured',
      enabled: account.enabled !== false,
      explicitId: account.id,
      explicitIndex,
    })
  })

  if (autoAccounts) {
    for (const account of autoAccounts) {
      if (!detectionEnabled || detectorDisabled.has(account.providerId)) continue
      if (config.disabledProviders.includes(account.providerId)) continue
      const key = keyFor(account.providerId, account.homeDir)
      if (excludedKeys.has(key)) continue
      if (configuredIds.has(account.id) || configuredKeys.has(key) || rowIds.has(account.id) || rowKeys.has(key)) continue
      const meta = PROVIDER_META[account.providerId]
      rememberRow({
        id: account.id,
        providerId: account.providerId,
        name: account.name,
        homeDir: account.homeDir || '~',
        color: account.color || meta.color,
        source: 'auto',
        enabled: true,
      })
    }
  }

  // Callers with a daemon snapshot already supplied canonical runtime accounts.
  // Only legacy/degraded callers without that inventory need synthesized defaults.
  if (autoAccounts === undefined) for (const providerId of PROVIDER_ORDER) {
    if (!detectionEnabled || detectorDisabled.has(providerId)) continue
    if (config.disabledProviders.includes(providerId)) continue
    if (!tracked.has(providerId)) continue
    const key = keyFor(providerId, '~')
    if (excludedKeys.has(key)) continue
    if (configuredIds.has(providerId) || configuredKeys.has(key) || rowIds.has(providerId) || rowKeys.has(key)) continue
    const meta = PROVIDER_META[providerId]
    rememberRow({
      id: providerId,
      providerId,
      name: meta.name,
      homeDir: '~',
      color: meta.color,
      source: 'auto',
      enabled: true,
    })
  }
  // An exclusion only suppresses anything while its provider is discovered at
  // all. With discovery or the provider turned off nothing is being suppressed,
  // so listing the tombstone would claim a removal that is not in effect.
  const suppressedKeys = suppressedAccounts
    && new Set(suppressedAccounts.map(ref => keyFor(ref.providerId, ref.homeDir)))
  for (const ref of config.accountDetection.excludedAccounts) {
    if (!detectionEnabled || detectorDisabled.has(ref.providerId)) continue
    if (config.disabledProviders.includes(ref.providerId)) continue
    if (configuredKeys.has(keyFor(ref.providerId, ref.homeDir))) continue
    const meta = PROVIDER_META[ref.providerId]
    rememberRow({
      id: `ignored:${ref.providerId}:${ref.homeDir}`,
      providerId: ref.providerId,
      name: `${meta.name} account`,
      homeDir: ref.homeDir,
      color: meta.color,
      source: 'ignored',
      enabled: false,
      excludedRef: ref,
      ...(suppressedKeys ? { live: suppressedKeys.has(keyFor(ref.providerId, ref.homeDir)) } : {}),
    })
  }

  return rows
}

/**
 * How a removed row reads. `live: false` means the home behind the exclusion is
 * gone, so there is nothing to restore — the only honest action is clearing the
 * tombstone. Both actions are the same un-exclude mutation; only the promise
 * differs. Undefined liveness keeps the pre-`suppressedAccounts` wording.
 */
export function removedRowCopy(live: boolean | undefined): { status: string; action: string } {
  return live === false
    ? { status: 'Removed · source not found', action: 'Forget' }
    : { status: 'Removed · not tracked', action: 'Restore' }
}
