// Map the TUI's Ink color NAMES to hex so the web matches the terminal exactly.
// Values are the user's actual Terminal.app "Clear Dark" ANSI palette (decoded
// from com.apple.Terminal) so the web reads identically to the live TUI.
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
  gray: '#8d9090',
  grey: '#8d9090',
}

const FALLBACK = '#8d9090'

/** Resolve an Ink color name (or hex) to a web hex. */
export function namedHex(name: string | undefined): string {
  if (!name) return FALLBACK
  if (name.startsWith('#')) return name
  return NAMED_HEX[name] ?? FALLBACK
}

/**
 * Resolve an account's display color: its custom color if set, else the
 * provider's color name. `providerColorName` is the provider's Ink `.color`.
 */
export function colorHex(accountColor: string | undefined, providerColorName: string): string {
  if (accountColor) {
    if (accountColor.startsWith('#')) return accountColor
    const named = NAMED_HEX[accountColor]
    if (named) return named
  }
  return namedHex(providerColorName)
}
