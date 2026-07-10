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
  /** Monotonically increasing, daemon-owned revision used for compare-and-set updates. */
  revision: number
  interval: number
  billingInterval: number
  clearScreen: boolean
  privacyMode: boolean
  privacyToggleKey: string
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

export interface ConfigRepair {
  config: Config
  repaired: boolean
  reasons: string[]
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
  revision: 0,
  interval: 2,
  billingInterval: 5,
  clearScreen: true,
  privacyMode: true,
  privacyToggleKey: 'p',
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
  grok: { name: 'Grok', color: 'yellowBright' },
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const EMAIL_RE_GLOBAL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export function containsEmail(value: string | null | undefined): boolean {
  return typeof value === 'string' && EMAIL_RE.test(value)
}

export function redactEmail(value: string): string {
  return value.replace(EMAIL_RE_GLOBAL, '[redacted]')
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validProvider(value: unknown): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId)
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function repairConfig(input: unknown): ConfigRepair {
  const reasons: string[] = []
  const parsed = isRecord(input) ? input : {}
  if (parsed !== input) reasons.push('config root was not an object')

  const rawAccounts = Array.isArray(parsed.accounts) ? parsed.accounts : []
  if (!Array.isArray(parsed.accounts) && parsed.accounts !== undefined) reasons.push('accounts was not an array')
  const accounts: Account[] = []
  const accountIds = new Set<string>()
  rawAccounts.forEach((raw, index) => {
    if (!isRecord(raw)) {
      reasons.push(`accounts[${index}] was not an object`)
      return
    }
    const providerId = raw.providerId ?? 'claude'
    if (!validProvider(providerId)) {
      reasons.push(`accounts[${index}].providerId was invalid`)
      return
    }
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : ''
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
    if (!id || !name) {
      reasons.push(`accounts[${index}] was missing id or name`)
      return
    }
    if (accountIds.has(id)) {
      reasons.push(`accounts[${index}].id was duplicated`)
      return
    }
    accountIds.add(id)
    accounts.push({
      id,
      providerId,
      name,
      homeDir: typeof raw.homeDir === 'string' && raw.homeDir.trim() ? raw.homeDir : '~',
      ...(typeof raw.color === 'string' && raw.color.trim() ? { color: raw.color } : {}),
    })
  })

  const disabledProviders = (Array.isArray(parsed.disabledProviders) ? parsed.disabledProviders : [])
    .filter(validProvider)
  if (parsed.disabledProviders !== undefined && !Array.isArray(parsed.disabledProviders)) {
    reasons.push('disabledProviders was not an array')
  }

  const knownProviders = Array.isArray(parsed.knownProviders)
    ? parsed.knownProviders.filter(validProvider)
    : (parsed.onboarded === true ? [...LEGACY_KNOWN] : [])
  if (parsed.knownProviders !== undefined && !Array.isArray(parsed.knownProviders)) {
    reasons.push('knownProviders was not an array')
  }

  const activeAccountId = typeof parsed.activeAccountId === 'string' && (accountIds.has(parsed.activeAccountId) || PROVIDER_IDS.includes(parsed.activeAccountId as ProviderId))
    ? parsed.activeAccountId
    : null
  if (parsed.activeAccountId !== undefined && parsed.activeAccountId !== null && activeAccountId === null) {
    reasons.push('activeAccountId did not match a known account/provider')
  }

  const timezone = typeof parsed.timezone === 'string' && parsed.timezone.trim() && isValidTimezone(parsed.timezone.trim())
    ? parsed.timezone.trim()
    : null
  if (parsed.timezone !== undefined && parsed.timezone !== null && timezone === null) {
    reasons.push('timezone was invalid')
  }

  const config: Config = {
    ...DEFAULTS,
    revision: typeof parsed.revision === 'number' && Number.isSafeInteger(parsed.revision) && parsed.revision >= 0
      ? parsed.revision
      : DEFAULTS.revision,
    interval: clampNum(parsed.interval, DEFAULTS.interval, 1),
    billingInterval: clampNum(parsed.billingInterval, DEFAULTS.billingInterval, 1),
    clearScreen: typeof parsed.clearScreen === 'boolean' ? parsed.clearScreen : DEFAULTS.clearScreen,
    privacyMode: typeof parsed.privacyMode === 'boolean' ? parsed.privacyMode : DEFAULTS.privacyMode,
    privacyToggleKey: typeof parsed.privacyToggleKey === 'string' && parsed.privacyToggleKey.length === 1
      ? parsed.privacyToggleKey
      : DEFAULTS.privacyToggleKey,
    timezone,
    accounts,
    activeAccountId,
    disabledProviders,
    onboarded: parsed.onboarded === true,
    dashboardLayout: parsed.dashboardLayout === 'single' ? 'single' : 'grid',
    defaultFocus: parsed.defaultFocus === 'last' ? 'last' : 'all',
    ascii: parsed.ascii === 'on' ? 'on' : parsed.ascii === 'off' ? 'off' : 'auto',
    knownProviders,
  }

  for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
    if (!(key in parsed)) reasons.push(`missing ${key}`)
  }

  return { config, repaired: reasons.length > 0 || !sameJson(parsed, config), reasons }
}

export function normalizeConfig(parsed: unknown): Config {
  try {
    return repairConfig(parsed).config
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
