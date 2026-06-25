// Node-free module: no node:fs/os/path imports (required for Vite SPA build compatibility).

import { PROVIDER_IDS, type ProviderId } from './providers/types'

export { PROVIDER_IDS } from './providers/types'

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
  onboarded: boolean
  dashboardLayout: 'grid' | 'single'
  defaultFocus: 'all' | 'last'
  ascii: 'auto' | 'on' | 'off'
  knownProviders: ProviderId[]
}

export type TrackedAccountSource = 'auto' | 'configured'

export interface TrackedAccountRow {
  id: string
  providerId: ProviderId
  name: string
  homeDir: string
  color: string
  source: TrackedAccountSource
  explicitId?: string
  explicitIndex?: number
}

export interface TrackedAccountCandidate {
  id: string
  providerId: ProviderId
  name: string
  homeDir?: string | null
  color?: string | null
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

export const PROVIDER_ORDER: ProviderId[] = [...PROVIDER_IDS]

export const COLOR_PALETTE = [
  'cyan', 'magenta', 'green', 'yellow', 'blue', 'red',
  'cyanBright', 'magentaBright', 'greenBright',
] as const

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

export function getTrackedAccountRows(
  config: Config,
  trackedProviders: readonly ProviderId[] = PROVIDER_ORDER.filter(pid => !config.disabledProviders.includes(pid)),
  autoAccounts?: readonly TrackedAccountCandidate[],
): TrackedAccountRow[] {
  const tracked = new Set(trackedProviders)
  const configuredIds = new Set<string>()
  const configuredKeys = new Set<string>()
  const rowIds = new Set<string>()
  const rowKeys = new Set<string>()
  const rows: TrackedAccountRow[] = []

  const keyFor = (providerId: ProviderId, homeDir?: string | null) =>
    `${providerId}:${homeDir && homeDir !== '~' ? homeDir : '~'}`

  const rememberRow = (row: TrackedAccountRow): void => {
    rowIds.add(row.id)
    rowKeys.add(keyFor(row.providerId, row.homeDir))
    rows.push(row)
  }

  config.accounts.forEach((account, explicitIndex) => {
    const meta = PROVIDER_META[account.providerId]
    configuredIds.add(account.id)
    configuredKeys.add(keyFor(account.providerId, account.homeDir))
    rememberRow({
      id: account.id,
      providerId: account.providerId,
      name: account.name,
      homeDir: account.homeDir || '~',
      color: account.color || meta.color,
      source: 'configured',
      explicitId: account.id,
      explicitIndex,
    })
  })

  if (autoAccounts) {
    for (const account of autoAccounts) {
      if (config.disabledProviders.includes(account.providerId)) continue
      const key = keyFor(account.providerId, account.homeDir)
      if (configuredIds.has(account.id) || configuredKeys.has(key) || rowIds.has(account.id) || rowKeys.has(key)) continue
      const meta = PROVIDER_META[account.providerId]
      rememberRow({
        id: account.id,
        providerId: account.providerId,
        name: account.name,
        homeDir: account.homeDir || '~',
        color: account.color || meta.color,
        source: 'auto',
      })
    }
  }

  for (const providerId of PROVIDER_ORDER) {
    if (config.disabledProviders.includes(providerId)) continue
    if (!tracked.has(providerId)) continue
    const key = keyFor(providerId, '~')
    if (configuredIds.has(providerId) || configuredKeys.has(key) || rowIds.has(providerId) || rowKeys.has(key)) continue
    const meta = PROVIDER_META[providerId]
    rememberRow({
      id: providerId,
      providerId,
      name: meta.name,
      homeDir: '~',
      color: meta.color,
      source: 'auto',
    })
  }

  return rows
}

export function clampNum(v: unknown, fallback: number, min: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function normalizeConfig(parsed: Record<string, unknown>): Config {
  try {
    const accounts: Account[] = (Array.isArray(parsed.accounts) ? parsed.accounts : [])
      .map((a: Account) => ({ ...a, providerId: a.providerId ?? 'claude' }))
      .filter((a: Account) => typeof a?.id === 'string' && typeof a?.name === 'string' && PROVIDER_IDS.includes(a.providerId))
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

export function sanitizeTyped(input: string): string {
  if (!input) return ''
  return input
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1bO./g, '')
    .replace(/\x1b/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .replace(/\[20[01]~/g, '')
}
