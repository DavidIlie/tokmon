export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function resolveTimezone(cfg: string | null | undefined): string {
  if (!cfg) return systemTimezone()
  return isValidTimezone(cfg) ? cfg : systemTimezone()
}

const dayFmtCache = new Map<string, Intl.DateTimeFormat>()

function dayFmt(tz: string): Intl.DateTimeFormat {
  let f = dayFmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    })
    dayFmtCache.set(tz, f)
  }
  return f
}

export function dayKey(ts: number, tz: string): string {
  return dayFmt(tz).format(new Date(ts))
}

export function monthKey(ts: number, tz: string): string {
  return dayKey(ts, tz).slice(0, 7)
}

interface TzParts {
  y: number; m: number; d: number
  hh: number; mm: number; ss: number
  weekday: number
}

const partsFmtCache = new Map<string, Intl.DateTimeFormat>()

function partsFmt(tz: string): Intl.DateTimeFormat {
  let f = partsFmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short',
    })
    partsFmtCache.set(tz, f)
  }
  return f
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

function tzParts(ts: number, tz: string): TzParts {
  const parts = partsFmt(tz).formatToParts(new Date(ts))
  const get = (t: string): string => parts.find(p => p.type === t)?.value ?? ''
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    hh: Number(get('hour')),
    mm: Number(get('minute')),
    ss: Number(get('second')),
    weekday: WEEKDAY_MAP[get('weekday')] ?? 0,
  }
}

function instantFromTz(y: number, m: number, d: number, hh: number, mm: number, ss: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss)
  const r = tzParts(guess, tz)
  const rendered = Date.UTC(r.y, r.m - 1, r.d, r.hh, r.mm, r.ss)
  const offset = rendered - guess
  return guess - offset
}

export function startOfDay(ts: number, tz: string): number {
  const p = tzParts(ts, tz)
  return instantFromTz(p.y, p.m, p.d, 0, 0, 0, tz)
}

export function startOfMonth(ts: number, tz: string): number {
  const p = tzParts(ts, tz)
  return instantFromTz(p.y, p.m, 1, 0, 0, 0, tz)
}

export function startOfWeek(ts: number, tz: string): number {
  const p = tzParts(ts, tz)
  const offset = p.weekday === 0 ? 6 : p.weekday - 1
  return instantFromTz(p.y, p.m, p.d - offset, 0, 0, 0, tz)
}

export function monthsAgoStart(ts: number, months: number, tz: string): number {
  const p = tzParts(ts, tz)
  return instantFromTz(p.y, p.m - months, 1, 0, 0, 0, tz)
}

export function weekKey(ts: number, tz: string): string {
  return dayKey(startOfWeek(ts, tz), tz)
}
