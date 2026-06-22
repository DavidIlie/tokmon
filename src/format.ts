export function currency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00'
  if (value >= 10000) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `$${value.toFixed(2)}`
}

export function tokens(value: number): string {
  const v = Number.isFinite(value) && value > 0 ? value : 0
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(Math.floor(v))
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

export function resetIn(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(diff) || diff <= 0) return 'now'

  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `${mins}m`

  const hrs = Math.floor(mins / 60)
  const m = mins % 60
  if (hrs < 24) return `${hrs}h ${m}m`

  const days = Math.floor(hrs / 24)
  const h = hrs % 24
  return `${days}d ${h}h`
}
