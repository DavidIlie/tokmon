import type { ProviderId } from '../providers/types'

export const FALLBACK_HEX = '#8d9090'

export const NAMED_HEX: Record<string, string> = {
  green: '#6caa71',
  greenBright: '#79be7e',
  cyan: '#7ccbcd',
  cyanBright: '#84dde0',
  blue: '#6d96b4',
  blueBright: '#67b5ed',
  magenta: '#bd7bcd',
  magentaBright: '#d389e5',
  yellow: '#c4ac62',
  yellowBright: '#d9c074',
  red: '#b45648',
  redBright: '#cf6a5a',
  white: '#dee5eb',
  whiteBright: '#f3f5f5',
  gray: FALLBACK_HEX,
  grey: FALLBACK_HEX,
}

export const PROVIDER_HEX: Record<ProviderId, string> = {
  claude: NAMED_HEX.green,
  codex: NAMED_HEX.cyan,
  cursor: NAMED_HEX.magenta,
  copilot: NAMED_HEX.white,
  pi: NAMED_HEX.blue,
  opencode: NAMED_HEX.yellow,
  antigravity: NAMED_HEX.red,
  gemini: NAMED_HEX.greenBright,
}

export function namedHex(name: string | undefined | null): string {
  if (!name) return FALLBACK_HEX
  if (name.startsWith('#')) return name
  return NAMED_HEX[name] ?? FALLBACK_HEX
}

export const namedColorHex = namedHex

export function colorHex(accountColor: string | undefined | null, providerColorName: string): string {
  if (accountColor) {
    if (accountColor.startsWith('#')) return accountColor
    const named = NAMED_HEX[accountColor]
    if (named) return named
  }
  return namedHex(providerColorName)
}

export function providerHex(id: ProviderId | string): string {
  return PROVIDER_HEX[id as ProviderId] ?? FALLBACK_HEX
}

const MODEL_PALETTE = [
  '#00d7ff', '#00d787', '#e6b450', '#d75f87', '#5f87ff',
  '#af87ff', '#5fd7a7', '#ff8787', '#d7af5f', '#87d7ff',
  '#d787d7', '#9ee493', '#ffb454', '#7aa2f7', '#bb9af7',
]

const modelColorCache = new Map<string, string>()

export function modelColor(name: string): string {
  const cached = modelColorCache.get(name)
  if (cached) return cached
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const color = MODEL_PALETTE[hash % MODEL_PALETTE.length]
  modelColorCache.set(name, color)
  return color
}

export const TOKEN_BUCKET = {
  input: NAMED_HEX.blue,
  output: NAMED_HEX.green,
  cacheCreate: NAMED_HEX.yellow,
  cacheRead: NAMED_HEX.cyan,
} as const

export function shortModel(name: string): string {
  return name
    .replace(/^claude-/, '')
    .replace(/^gpt-/, 'gpt-')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '')
}
