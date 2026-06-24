import {
  formatCurrency,
  formatResetIn,
  formatShortDate,
  formatTime,
  formatTokens,
} from './shared/format'

export const currency = formatCurrency
export const tokens = formatTokens
export const time = formatTime

export function shortDate(iso: string): string {
  return formatShortDate(iso, { padDay: true })
}

export function col(s: string, w: number, align: 'left' | 'right' = 'right'): string {
  if (s.length > w) return s.slice(0, w - 1) + '~'
  const spaces = ' '.repeat(w - s.length)
  return align === 'right' ? spaces + s : s + spaces
}

export const resetIn = formatResetIn
