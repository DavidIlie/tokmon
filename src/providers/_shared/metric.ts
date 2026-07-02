import type { Metric } from '../types'

export const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export function finitePositive(value: unknown): number {
  return finiteNumber(value) && value > 0 ? value : 0
}

export function safeNum(value: unknown): number {
  return finiteNumber(value) && value > 0 ? Math.floor(value) : 0
}

export function finitePositiveCoerced(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

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
