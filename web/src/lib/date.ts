export const DAY = 86_400_000
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const parseDay = (label: string): number => {
  const [y, m, d] = label.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

export const fmtDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export const todayInTz = (tz: string): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export const dowMonday = (ms: number): number => (new Date(ms).getUTCDay() + 6) % 7

export const weekStartStr = (label: string): string => {
  const ms = parseDay(label)
  return fmtDay(ms - dowMonday(ms) * DAY)
}
