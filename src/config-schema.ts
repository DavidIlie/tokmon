// Browser-safe shared config schema + validation.
// IMPORTANT: This module must stay node-free (no node:fs/os/path imports) so the
// Vite SPA build (which re-exports from here via src/web/contract.ts) keeps working.
// Node-only IO (file read/write, path resolution, ~ expansion) lives in src/config.ts.

import type { ProviderId } from './providers/types'

export interface Account {
  id: string
  providerId: ProviderId
  name: string
  homeDir: string
  color?: string
}

export interface Config {
  interval: number
  billingInterval: number
  clearScreen: boolean
  timezone: string | null
  accounts: Account[]
  activeAccountId: string | null
  disabledProviders: ProviderId[]
  /** Set once the user has chosen their providers; false → show onboarding. */
  onboarded: boolean
  dashboardLayout: 'grid' | 'single'
  defaultFocus: 'all' | 'last'
  ascii: 'auto' | 'on' | 'off'
  knownProviders: ProviderId[]
}

export const DEFAULTS: Config = {
  interval: 2,
  billingInterval: 5,
  clearScreen: true,
  timezone: null,
  accounts: [],
  activeAccountId: null,
  disabledProviders: [],
  onboarded: false,
  dashboardLayout: 'grid',
  defaultFocus: 'all',
  ascii: 'auto',
  knownProviders: [],
}

const LEGACY_KNOWN: ProviderId[] = ['claude', 'codex', 'cursor']

export const ACCENT_COLORS = ['cyan', 'magenta', 'green', 'yellow', 'blue', 'red'] as const

// Canonical provider order. Kept identical to src/providers/index.ts
// PROVIDER_ORDER so the TUI and web present providers in the same sequence.
// PROVIDER_IDS / PROVIDER_META below use this same order so all three agree.
export const PROVIDER_ORDER: ProviderId[] = ['claude', 'codex', 'cursor', 'copilot', 'pi', 'opencode', 'antigravity', 'gemini']

export const PROVIDER_IDS: ProviderId[] = [...PROVIDER_ORDER]

/** Color palette exposed in the account form (TUI + web). */
export const COLOR_PALETTE = [
  'cyan', 'magenta', 'green', 'yellow', 'blue', 'red',
  'cyanBright', 'magentaBright', 'greenBright',
] as const

/**
 * Static provider name/color metadata. Kept here (rather than importing the
 * node-touching `PROVIDERS` registry) so this module stays browser-safe. Values
 * mirror the `id`/`name`/`color` of each provider definition under src/providers.
 * Insertion order matches PROVIDER_ORDER (= the TUI's canonical order).
 */
export const PROVIDER_META: Record<ProviderId, { name: string; color: string }> = {
  claude: { name: 'Claude', color: 'green' },
  codex: { name: 'Codex', color: 'cyan' },
  cursor: { name: 'Cursor', color: 'magenta' },
  copilot: { name: 'Copilot', color: 'white' },
  pi: { name: 'Pi', color: 'blue' },
  opencode: { name: 'opencode', color: 'yellow' },
  antigravity: { name: 'Antigravity', color: 'red' },
  gemini: { name: 'Gemini', color: 'greenBright' },
}

export function clampNum(v: unknown, fallback: number, min: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback
}

/**
 * Browser-safe IANA timezone validation. Same logic as src/tz.ts isValidTimezone
 * (Intl.DateTimeFormat throws RangeError on an unknown zone). Duplicated here
 * rather than imported because tz.ts transitively pulls node-only deps; this
 * module must stay node-free for the Vite build. Used by normalizeConfig (so
 * disk state is always a valid zone or null) and the web settings input.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Validate/normalize an already-parsed config object into a complete Config.
 * Pure: no file IO. Used by loadConfig (node) and shareable with web/daemon.
 */
export function normalizeConfig(parsed: Record<string, unknown>): Config {
  try {
    const accounts: Account[] = (Array.isArray(parsed.accounts) ? parsed.accounts : [])
      .map((a: Account) => ({ ...a, providerId: a.providerId ?? 'claude' }))
      .filter((a: Account) => typeof a?.id === 'string' && typeof a?.name === 'string' && PROVIDER_IDS.includes(a.providerId))
    // Build from DEFAULTS + the explicitly re-validated known fields ONLY (no
    // `...parsed` passthrough): a PUT /api/config body with extra/unknown keys
    // can't inject persistent junk into config.json (it round-trips every load).
    return {
      ...DEFAULTS,
      interval: clampNum(parsed.interval, DEFAULTS.interval, 1),
      billingInterval: clampNum(parsed.billingInterval, DEFAULTS.billingInterval, 1),
      clearScreen: typeof parsed.clearScreen === 'boolean' ? parsed.clearScreen : DEFAULTS.clearScreen,
      timezone: typeof parsed.timezone === 'string' && parsed.timezone.trim() && isValidTimezone(parsed.timezone.trim())
        ? parsed.timezone
        : null,
      accounts,
      activeAccountId: typeof parsed.activeAccountId === 'string' ? parsed.activeAccountId : null,
      disabledProviders: (Array.isArray(parsed.disabledProviders) ? parsed.disabledProviders : [])
        .filter((p: unknown): p is ProviderId => PROVIDER_IDS.includes(p as ProviderId)),
      onboarded: parsed.onboarded === true,
      dashboardLayout: parsed.dashboardLayout === 'single' ? 'single' : 'grid',
      defaultFocus: parsed.defaultFocus === 'last' ? 'last' : 'all',
      ascii: parsed.ascii === 'on' ? 'on' : parsed.ascii === 'off' ? 'off' : 'auto',
      knownProviders: Array.isArray(parsed.knownProviders)
        ? parsed.knownProviders.filter((p: unknown): p is ProviderId => PROVIDER_IDS.includes(p as ProviderId))
        : (parsed.onboarded === true ? [...LEGACY_KNOWN] : []),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
}

export function generateAccountId(name: string, existing: Account[]): string {
  const base = slugify(name) || 'account'
  const taken = new Set(existing.map(a => a.id))
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

export function pickAccentColor(existing: Account[]): string {
  const used = new Set(existing.map(a => a.color).filter(Boolean))
  for (const c of ACCENT_COLORS) {
    if (!used.has(c)) return c
  }
  return ACCENT_COLORS[existing.length % ACCENT_COLORS.length]
}

/**
 * Strip terminal escape sequences and control chars from typed input, returning
 * clean typeable text. Removes:
 *  - CSI sequences (ESC [ ... final byte 0x40-0x7e)
 *  - SS3 sequences (ESC O <byte>)
 *  - OSC sequences (ESC ] ... terminated by BEL or ST)
 *  - any remaining lone ESC
 *  - C0/C1 control chars (0x00-0x1f, 0x7f, 0x80-0x9f)
 *  - bracketed-paste markers whose leading ESC was already stripped upstream
 *    (Ink strips one leading ESC before useInput sees the chunk, leaving a bare
 *    `[200~` / `[201~`), so they don't leak into focused fields as `[200~`.
 * Printable text and normal unicode (incl. emoji) are preserved.
 */
export function sanitizeTyped(input: string): string {
  if (!input) return ''
  return input
    // OSC: ESC ] ... ( BEL | ESC \ )
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    // CSI: ESC [ (params/intermediates) final-byte
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // SS3: ESC O <byte>
    .replace(/\x1bO./g, '')
    // any remaining lone ESC
    .replace(/\x1b/g, '')
    // C0 controls (excluding ESC already handled), DEL, C1 controls
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    // bare bracketed-paste markers left after the leading ESC was stripped
    .replace(/\[20[01]~/g, '')
}
