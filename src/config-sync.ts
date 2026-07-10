import type { Config } from './config'
import type { ConfigState } from './rpc/contract'

export interface PendingConfigUpdate {
  config: Config
  expectedRevision: number
}

function configDocument(config: Config): Omit<Config, 'revision'> {
  const { revision: _revision, ...document } = config
  return document
}

export function sameConfigDocument(a: Config, b: Config): boolean {
  return deepEqual(configDocument(a), configDocument(b))
}

/** Keeps a dirty editor from silently replacing its draft after a stream reconnect. */
export function reconcileSettingsDraft(
  draft: Config | null,
  revision: number | null,
  dirty: boolean,
  incoming: ConfigState,
): { draft: Config | null; revision: number | null; conflict: boolean } {
  if (!dirty) {
    if (revision !== null && incoming.config.revision < revision) {
      return { draft, revision, conflict: false }
    }
    return { draft: incoming.config, revision: incoming.config.revision, conflict: false }
  }
  return {
    draft,
    revision,
    conflict: revision !== null && incoming.config.revision > revision,
  }
}

export interface ConfigUpdateFailureDetails {
  message: string
  conflictState: ConfigState | null
}

export function describeConfigUpdateFailure(cause: unknown): ConfigUpdateFailureDetails {
  if (cause && typeof cause === 'object') {
    const failure = cause as Record<string, unknown>
    if (failure.kind === 'conflict') {
      const state = failure.state as ConfigState | undefined
      const revision = state?.config?.revision
      return {
        message: typeof revision === 'number'
          ? `configuration changed elsewhere (daemon revision ${revision})`
          : 'settings changed elsewhere; reload before saving',
        conflictState: state?.config && typeof revision === 'number' ? state : null,
      }
    }
    if (failure.kind === 'persistence' && typeof failure.message === 'string') {
      return { message: failure.message, conflictState: null }
    }
  }
  return {
    message: cause instanceof Error ? cause.message : 'config update failed',
    conflictState: null,
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

export function reconcileDaemonConfig(
  previous: Config | null,
  daemonConfig: Config,
  pendingLocalConfig: PendingConfigUpdate | null,
): { config: Config | null; pendingLocalConfig: PendingConfigUpdate | null; conflict: boolean } {
  if (pendingLocalConfig) {
    if (
      daemonConfig.revision === pendingLocalConfig.expectedRevision + 1
      && sameConfigDocument(daemonConfig, pendingLocalConfig.config)
    ) {
      return { config: previous && deepEqual(previous, daemonConfig) ? previous : daemonConfig, pendingLocalConfig: null, conflict: false }
    }
    if (daemonConfig.revision > pendingLocalConfig.expectedRevision) {
      return { config: daemonConfig, pendingLocalConfig: null, conflict: true }
    }
    return { config: previous ?? pendingLocalConfig.config, pendingLocalConfig, conflict: false }
  }

  if (previous && deepEqual(previous, daemonConfig)) {
    return { config: previous, pendingLocalConfig: null, conflict: false }
  }

  return { config: daemonConfig, pendingLocalConfig: null, conflict: false }
}
