import type { ProviderId } from '../providers/types'

export const PROVIDER_HEX: Record<ProviderId, string> = {
  claude: '#00d787',
  codex: '#00d7ff',
  cursor: '#5f87ff',
  copilot: '#5fd7a7',
  pi: '#e6b450',
  opencode: '#d75f87',
  antigravity: '#d75f5f',
  gemini: '#af87ff',
}

const NAMED_HEX: Record<string, string> = {
  green: '#00d787',
  cyan: '#00d7ff',
  blue: '#5f87ff',
  yellow: '#e6b450',
  magenta: '#d75f87',
  red: '#d75f5f',
  greenBright: '#5cffbf',
  cyanBright: '#5fe9ff',
  blueBright: '#87afff',
  yellowBright: '#ffd75f',
  magentaBright: '#ff87c7',
  redBright: '#ff8787',
}

export function colorHex(color: string | undefined, providerId: ProviderId): string {
  if (color) {
    if (color.startsWith('#')) return color
    const named = NAMED_HEX[color]
    if (named) return named
  }
  return PROVIDER_HEX[providerId] ?? '#8b979c'
}
