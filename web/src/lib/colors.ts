import type { ProviderId } from '@shared'

// Keep in sync with TUI palette (Ink color name → terminal hex) and each provider's `.color`.
export const PROVIDER_HEX: Record<string, string> = {
  claude: '#6caa71',
  codex: '#7ccbcd',
  cursor: '#bd7bcd',
  copilot: '#dee5eb',
  pi: '#6d96b4',
  opencode: '#c4ac62',
  antigravity: '#b45648',
  gemini: '#79be7e',
}

export function providerHex(id: ProviderId | string): string {
  return PROVIDER_HEX[id] ?? '#8b979c'
}

// Ink/terminal named-color → hex. Mirrors the COLOR_PALETTE the TUI account form
// offers (cyan…greenBright). Tuned to read on the dark dashboard while staying
// recognizably the same hue as the terminal swatch the TUI shows.
export const NAMED_COLOR_HEX: Record<string, string> = {
  cyan: '#7ccbcd',
  magenta: '#bd7bcd',
  green: '#6caa71',
  yellow: '#d9c074',
  blue: '#6d96b4',
  red: '#cf6a5a',
  cyanBright: '#9ee8ea',
  magentaBright: '#d79ae3',
  greenBright: '#8fd594',
  white: '#dee5eb',
}

/** Resolve a stored account color (a named color, or already a hex/css value). */
export function namedColorHex(name: string | undefined | null): string {
  if (!name) return '#8b979c'
  return NAMED_COLOR_HEX[name] ?? (name.startsWith('#') ? name : '#8b979c')
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
  input: '#6d96b4',
  output: '#6caa71',
  cacheCreate: '#c4ac62',
  cacheRead: '#7ccbcd',
} as const

export function shortModel(name: string): string {
  return name
    .replace(/^claude-/, '')
    .replace(/^gpt-/, 'gpt-')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '')
}
