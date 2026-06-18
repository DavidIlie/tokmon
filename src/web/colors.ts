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

export function namedHex(name: string | undefined): string {
  if (!name) return FALLBACK
  if (name.startsWith('#')) return name
  return NAMED_HEX[name] ?? FALLBACK
}

export function colorHex(accountColor: string | undefined, providerColorName: string): string {
  if (accountColor) {
    if (accountColor.startsWith('#')) return accountColor
    const named = NAMED_HEX[accountColor]
    if (named) return named
  }
  return namedHex(providerColorName)
}
