// Shared UTC date helpers. Kept timezone-free (operates on the YYYY-MM-DD / YYYY-MM
// labels the server already emits in the user's tz) so the period math and the calendar
// heatmap can't drift apart.

export const DAY = 86_400_000
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Parse a 'YYYY-MM-DD' or 'YYYY-MM' label to a UTC epoch (missing parts default to 1). */
export const parseDay = (label: string): number => {
  const [y, m, d] = label.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

/** Format a UTC epoch back to 'YYYY-MM-DD'. */
export const fmtDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Day of week with Monday = 0 … Sunday = 6 (ISO order for the heatmap rows). */
export const dowMonday = (ms: number): number => (new Date(ms).getUTCDay() + 6) % 7

/** Monday week-start label for the week containing `label`. */
export const weekStartStr = (label: string): string => {
  const ms = parseDay(label)
  return fmtDay(ms - dowMonday(ms) * DAY)
}
