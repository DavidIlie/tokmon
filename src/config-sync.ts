import type { Config } from './config'

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
  pendingLocalConfig: Config | null,
): { config: Config | null; pendingLocalConfig: Config | null } {
  if (pendingLocalConfig) {
    if (deepEqual(daemonConfig, pendingLocalConfig)) {
      return { config: previous && deepEqual(previous, daemonConfig) ? previous : daemonConfig, pendingLocalConfig: null }
    }
    return { config: previous ?? pendingLocalConfig, pendingLocalConfig }
  }

  if (previous && deepEqual(previous, daemonConfig)) {
    return { config: previous, pendingLocalConfig: null }
  }

  if (previous?.onboarded === true && daemonConfig.onboarded === false) {
    return { config: previous, pendingLocalConfig: null }
  }

  return { config: daemonConfig, pendingLocalConfig: null }
}
