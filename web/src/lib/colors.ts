import type { ProviderId } from '@shared'

export const PROVIDER_HEX: Record<string, string> = {
  claude: '#00d787',
  codex: '#00d7ff',
  cursor: '#5f87ff',
  copilot: '#5fd7a7',
  pi: '#e6b450',
  opencode: '#d75f87',
  antigravity: '#d75f5f',
  gemini: '#af87ff',
}

export function providerHex(id: ProviderId | string): string {
  return PROVIDER_HEX[id] ?? '#8b979c'
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
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const c = MODEL_PALETTE[h % MODEL_PALETTE.length]
  modelColorCache.set(name, c)
  return c
}

export const TOKEN_BUCKET = {
  input: '#5f87ff',
  output: '#00d787',
  cacheCreate: '#e6b450',
  cacheRead: '#00d7ff',
} as const

export function shortModel(name: string): string {
  return name
    .replace(/^claude-/, '')
    .replace(/^gpt-/, 'gpt-')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '')
}
