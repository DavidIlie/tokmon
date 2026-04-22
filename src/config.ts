import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface Config {
  interval: number
  billingInterval: number
  clearScreen: boolean
  timezone: string | null
}

const DEFAULTS: Config = { interval: 2, billingInterval: 5, clearScreen: true, timezone: null }

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
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = configDir()
  await mkdir(dir, { recursive: true })
  await writeFile(configLocation(), JSON.stringify(config, null, 2) + '\n')
}
