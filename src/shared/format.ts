export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export interface CurrencyOptions {
  sign?: boolean
}

export function formatCurrency(value: number, opts: CurrencyOptions = {}): string {
  if (!Number.isFinite(value)) return '$0.00'
  const sign = opts.sign && value > 0 ? '+' : ''
  const abs = Math.abs(value)
  if (abs >= 100_000) return `${sign}$${(value / 1000).toFixed(0)}k`
  if (abs >= 10_000) return `${sign}$${(value / 1000).toFixed(1)}k`
  if (abs >= 1) return `${sign}$${value.toFixed(2)}`
  if (abs >= 0.01) return `${sign}$${value.toFixed(3)}`
  if (abs === 0) return '$0.00'
  return `${sign}$${value.toFixed(4)}`
}

export function formatCurrencyAxis(value: number): string {
  if (!Number.isFinite(value)) return '$0'
  const abs = Math.abs(value)
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1000) return `$${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (abs >= 1) return `$${Math.round(value)}`
  if (abs === 0) return '$0'
  return `$${value.toFixed(2)}`
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(Math.round(value))
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.round(value).toLocaleString('en-US')
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (abs >= 1e4) return `${Math.round(value / 1e3)}k`
  return Math.round(value).toLocaleString('en-US')
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '0%'
  return `${(value * 100).toFixed(digits)}%`
}

export function formatTime(date: Date, tz?: string): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: tz,
  })
}

export function formatAgo(ms: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function formatShortDate(label: string, opts: { padDay?: boolean } = {}): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label)
  if (!match) return label
  const day = Number(match[3])
  return `${MONTHS[Number(match[2]) - 1]} ${opts.padDay ? day.toString().padStart(2, ' ') : day}`
}

export function formatDayLabel(label: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label)
  if (day) return `${MONTHS[Number(day[2]) - 1]} ${Number(day[3])}`
  const month = /^(\d{4})-(\d{2})$/.exec(label)
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`
  return label
}

export function formatResetIn(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now
  if (!Number.isFinite(diff) || diff <= 0) return 'now'

  const minutes = Math.round(diff / 60_000)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) return `${hours}h ${mins}m`

  const days = Math.floor(hours / 24)
  const hrs = hours % 24
  return `${days}d ${hrs}h`
}

export function sumTokens(tokens: { input: number; output: number; cacheCreate: number; cacheRead: number }): number {
  return tokens.input + tokens.output + tokens.cacheCreate + tokens.cacheRead
}
