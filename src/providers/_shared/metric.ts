import type { Metric } from '../types'

export const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function percentMetric(label: string, used: number, resetsAt: string | null, primary?: boolean): Metric {
  return {
    label,
    used: finite(used),
    limit: 100,
    format: { kind: 'percent' },
    resetsAt,
    ...(primary === undefined ? {} : { primary }),
  }
}

export const dollars = (cents: number): number => finite(cents) / 100
