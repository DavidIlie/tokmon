import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import type { ProviderId } from './providers/types'

/** An env var as a usable base dir only if it's a non-empty absolute path. */
export function envDir(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() && isAbsolute(v.trim()) ? v.trim() : undefined
}

/** A user-configured account. `providerId` defaults to 'claude' for legacy configs. */
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
  /** 'grid' = all providers in a responsive grid; 'single' = one provider at a time (cycle). */
  dashboardLayout: 'grid' | 'single'
  /** 'all' = start focused on All; 'last' = remember the last focused account. */
  defaultFocus: 'all' | 'last'
}

const DEFAULTS: Config = {
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
}

const ACCENT_COLORS = ['cyan', 'magenta', 'green', 'yellow', 'blue', 'red'] as const

function configDir(): string {
  if (process.platform === 'win32') {
    return join(envDir('APPDATA') ?? join(homedir(), 'AppData', 'Roaming'), 'tokmon')
  }
  return join(envDir('XDG_CONFIG_HOME') ?? join(homedir(), '.config'), 'tokmon')
}

export function configLocation(): string {
  return join(configDir(), 'config.json')
}

export function cacheDir(): string {
  if (process.platform === 'win32') {
    return join(envDir('LOCALAPPDATA') ?? envDir('APPDATA') ?? join(homedir(), 'AppData', 'Local'), 'tokmon', 'cache')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'tokmon')
  }
  return join(envDir('XDG_CACHE_HOME') ?? join(homedir(), '.cache'), 'tokmon')
}

const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'cursor']

/** A finite number ≥ min, else the fallback (guards hand-edited/garbage values). */
function clampNum(v: unknown, fallback: number, min: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback
}

export async function loadConfig(): Promise<Config> {
  let raw: string
  try {
    raw = await readFile(configLocation(), 'utf-8')
  } catch {
    return { ...DEFAULTS }   // no config yet → first run
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupt config — back it up rather than silently overwriting it later.
    try { await writeFile(configLocation() + '.bak', raw) } catch {}
    return { ...DEFAULTS }
  }
  try {
    const accounts: Account[] = (Array.isArray(parsed.accounts) ? parsed.accounts : [])
      // Legacy configs predate providers — those accounts are all Claude.
      .map((a: Account) => ({ ...a, providerId: a.providerId ?? 'claude' }))
      // Drop malformed / unknown-provider accounts so the UI never crashes on them.
      .filter((a: Account) => typeof a?.id === 'string' && typeof a?.name === 'string' && PROVIDER_IDS.includes(a.providerId))
    return {
      ...DEFAULTS,
      ...parsed,
      // Coerce the numeric/boolean knobs: a hand-edited `"interval": "fast"` or
      // a negative value would otherwise reach setTimeout as NaN → a 0ms tight
      // poll loop. Clamp to sane minimums.
      interval: clampNum(parsed.interval, DEFAULTS.interval, 1),
      billingInterval: clampNum(parsed.billingInterval, DEFAULTS.billingInterval, 1),
      clearScreen: typeof parsed.clearScreen === 'boolean' ? parsed.clearScreen : DEFAULTS.clearScreen,
      timezone: typeof parsed.timezone === 'string' && parsed.timezone.trim() ? parsed.timezone : null,
      accounts,
      activeAccountId: typeof parsed.activeAccountId === 'string' ? parsed.activeAccountId : null,
      disabledProviders: (Array.isArray(parsed.disabledProviders) ? parsed.disabledProviders : [])
        .filter((p: unknown): p is ProviderId => PROVIDER_IDS.includes(p as ProviderId)),
      // Only skip onboarding when it was explicitly completed. Configs that
      // predate the flag (even ones with a legacy account) still get the
      // provider picker once, so existing users can opt into Codex/Cursor.
      onboarded: parsed.onboarded === true,
      dashboardLayout: parsed.dashboardLayout === 'single' ? 'single' : 'grid',
      defaultFocus: parsed.defaultFocus === 'last' ? 'last' : 'all',
    }
  } catch {
    return { ...DEFAULTS }
  }
}

// Serialize saves so rapid setting changes can't interleave/corrupt the file,
// and write atomically (temp + rename) so a crash mid-write can't truncate it.
let saveQueue: Promise<void> = Promise.resolve()

export function saveConfig(config: Config): Promise<void> {
  saveQueue = saveQueue.then(async () => {
    try {
      const dir = configDir()
      await mkdir(dir, { recursive: true })
      const tmp = join(dir, `config.json.${process.pid}.tmp`)
      await writeFile(tmp, JSON.stringify(config, null, 2) + '\n')
      await rename(tmp, configLocation())
    } catch {
      // Best-effort: a failed settings write must never reject this queue. The
      // sole caller fires it without awaiting, so a rejection would surface as
      // a fatal unhandledRejection and take down the whole TUI.
    }
  })
  return saveQueue
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

export function expandHome(p: string): string {
  if (!p) return homedir()
  if (p === '~' || p === '~/' || p === '~\\') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

export function findAccount(config: Config, id: string | null): Account | null {
  if (!id) return null
  return config.accounts.find(a => a.id === id) ?? null
}
