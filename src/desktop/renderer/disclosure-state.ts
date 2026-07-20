/** Storage surface used for desktop-only disclosure state. Kept separate from Tokmon's
 * daemon config because changing an accordion must never reconfigure data providers. */
export interface DisclosureStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const EXPANDED_PROVIDERS_KEY = 'tokmon.desktop.expandedProviders.v1'

function knownUnique(ids: readonly unknown[], known: ReadonlySet<string>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of ids) {
    if (typeof value !== 'string' || !known.has(value) || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

/** Read local UI state, falling back once to the legacy daemon-config field. */
export function readExpandedProviders(
  storage: DisclosureStorage,
  known: ReadonlySet<string>,
  legacy: readonly string[] = [],
): string[] {
  try {
    const raw = storage.getItem(EXPANDED_PROVIDERS_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? knownUnique(parsed, known) : []
    }
  } catch {}
  return knownUnique(legacy, known)
}

/** Persist a tiny desktop-only preference without touching daemon/provider state. */
export function writeExpandedProviders(
  storage: DisclosureStorage,
  ids: readonly string[],
  known: ReadonlySet<string>,
): string[] {
  const normalized = knownUnique(ids, known)
  storage.setItem(EXPANDED_PROVIDERS_KEY, JSON.stringify(normalized))
  return normalized
}
