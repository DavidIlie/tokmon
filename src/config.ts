import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { DEFAULTS, normalizeConfig, type Config, type Account } from './config-schema'

// Re-export the browser-safe schema so existing importers keep working unchanged.
export type { Config, Account } from './config-schema'
export {
  DEFAULTS,
  ACCENT_COLORS,
  PROVIDER_IDS,
  COLOR_PALETTE,
  PROVIDER_META,
  clampNum,
  normalizeConfig,
  slugify,
  generateAccountId,
  pickAccentColor,
  sanitizeTyped,
} from './config-schema'

export function envDir(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() && isAbsolute(v.trim()) ? v.trim() : undefined
}

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

export async function loadConfig(): Promise<Config> {
  let raw: string
  try {
    raw = await readFile(configLocation(), 'utf-8')
  } catch {
    return { ...DEFAULTS }
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    try { await writeFile(configLocation() + '.bak', raw) } catch {}
    return { ...DEFAULTS }
  }
  return normalizeConfig(parsed)
}

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
    }
  })
  return saveQueue
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
