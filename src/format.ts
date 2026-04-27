export function currency(value: number): string {
  if (value >= 10000) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `$${value.toFixed(2)}`
}

export function tokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export function time(date: Date, tz?: string): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: tz,
  })
}

const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${SHORT_MONTHS[Number(m)]} ${Number(d).toString().padStart(2, ' ')}`
}

export function col(s: string, w: number, align: 'left' | 'right' = 'right'): string {
  if (s.length > w) return s.slice(0, w - 1) + '~'
  const spaces = ' '.repeat(w - s.length)
  return align === 'right' ? spaces + s : s + spaces
}
