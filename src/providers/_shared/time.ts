export const EPOCH_SECONDS_BOUNDARY = 10_000_000_000

export function epochMilliseconds(value: number): number {
  return Math.abs(value) < EPOCH_SECONDS_BOUNDARY ? value * 1000 : value
}

export function msToIso(ms: number): string | null {
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null
}

export function timestampMs(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[-+]?\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : NaN
  if (Number.isFinite(numeric)) {
    const ms = epochMilliseconds(numeric)
    return ms > 0 && Math.abs(ms) <= 8.64e15 ? ms : null
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value.trim())
  return Number.isFinite(ms) && ms > 0 ? ms : null
}
