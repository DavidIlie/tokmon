export function currency(value: number): string {
  return `$${value.toFixed(2)}`
}

export function tokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export function num(value: number): string {
  return value.toLocaleString()
}

export function time(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function minutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function pad(s: string, w: number, align: 'left' | 'right' = 'right'): string {
  if (s.length >= w) return s.slice(0, w)
  const spaces = ' '.repeat(w - s.length)
  return align === 'right' ? spaces + s : s + spaces
}
