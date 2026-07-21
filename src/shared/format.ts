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
  if (abs >= 1) {
    const polarity = value < 0 ? '-' : ''
    return `${sign}${polarity}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
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

/** Four-character menu-bar token count: 999, 1K, 1.2M, 1B. */
export function formatCompactTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '–'
  if (value < 1_000) return String(Math.round(value))
  const units = [
    { size: 1e12, suffix: 'T' },
    { size: 1e9, suffix: 'B' },
    { size: 1e6, suffix: 'M' },
    { size: 1e3, suffix: 'K' },
  ] as const
  const unit = units.find((candidate, index) => value >= candidate.size * (index === units.length - 1 ? 1 : 0.9995))!
  const scaled = value / unit.size
  const shown = scaled < 10
    ? scaled.toFixed(1).replace(/\.0$/, '')
    : String(Math.round(scaled))
  return `${shown}${unit.suffix}`
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

export interface ResetParts {
  days: number
  hours: number
  minutes: number
  totalMinutes: number
}

/**
 * The single rounding rule for "time until reset", shared by the web/TUI
 * relative label and the desktop compact copy so they can never disagree on a
 * boundary. Whole minutes, rounded up (never under-report the time left) and
 * floored at 1 for any positive remainder. Returns null once the reset has
 * passed (diff ≤ 0) or the input is not finite. Surfaces keep their own display
 * style ("3h 0m" vs "3h"); only the arithmetic is shared.
 */
export function resetParts(diffMs: number): ResetParts | null {
  if (!Number.isFinite(diffMs) || diffMs <= 0) return null
  const totalMinutes = Math.max(1, Math.ceil(diffMs / 60_000))
  return {
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor((totalMinutes % (24 * 60)) / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
  }
}

export function formatResetIn(iso: string, now = Date.now()): string {
  const parts = resetParts(new Date(iso).getTime() - now)
  if (!parts) return 'now'
  if (parts.days > 0) return `${parts.days}d ${parts.hours}h`
  if (parts.hours > 0) return `${parts.hours}h ${parts.minutes}m`
  return `${parts.minutes}m`
}

export function formatResetAt(
  iso: string,
  display: 'relative' | 'absolute',
  now = Date.now(),
  tz?: string,
): string {
  const timestamp = Date.parse(iso)
  // Snapshot caches from releases before v0.25 stored already-formatted values.
  // Keep those readable until the next successful provider refresh replaces them.
  if (!Number.isFinite(timestamp)) return iso
  if (display === 'relative') return formatResetIn(iso, now)
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(timestamp))
}

export function sumTokens(tokens: { input: number; output: number; cacheCreate: number; cacheRead: number }): number {
  return tokens.input + tokens.output + tokens.cacheCreate + tokens.cacheRead
}
