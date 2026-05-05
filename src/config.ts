import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface Account {
  id: string
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
}

const DEFAULTS: Config = {
  interval: 2,
  billingInterval: 5,
  clearScreen: true,
  timezone: null,
  accounts: [],
  activeAccountId: null,
}

const ACCENT_COLORS = ['cyan', 'magenta', 'green', 'yellow', 'blue', 'red'] as const

function configDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'tokmon')
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(xdg, 'tokmon')
}

export function configLocation(): string {
  return join(configDir(), 'config.json')
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(configLocation(), 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULTS,
      ...parsed,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      activeAccountId: typeof parsed.activeAccountId === 'string' ? parsed.activeAccountId : null,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = configDir()
  await mkdir(dir, { recursive: true })
  await writeFile(configLocation(), JSON.stringify(config, null, 2) + '\n')
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
  if (p === '~' || p === '~/') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

export function findAccount(config: Config, id: string | null): Account | null {
  if (!id) return null
  return config.accounts.find(a => a.id === id) ?? null
}
