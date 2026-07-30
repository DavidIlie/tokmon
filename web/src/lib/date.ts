import { dayKey, mondayDayIndex, MONTHS, systemTimezone, weekStartDayKey } from '@shared'

export const DAY = 86_400_000
export { MONTHS }

export const parseDay = (label: string): number => {
  const [y, m, d] = label.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

export const fmtDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export const todayInTz = (tz: string): string => {
  try {
    return dayKey(Date.now(), tz || systemTimezone())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export const dowMonday = (ms: number): number => mondayDayIndex(new Date(ms).getUTCDay())

export const weekStartStr = weekStartDayKey
