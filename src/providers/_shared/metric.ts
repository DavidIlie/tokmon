import type { Metric } from '../types'
import { clampPct } from '../../usage-semantics'

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

export function percentMetric(
  label: string,
  used: number,
  resetsAt: string | null,
  primary?: boolean,
  options?: { clamp?: boolean },
): Metric {
  return {
    label,
    used: options?.clamp ? clampPct(finite(used)) : finite(used),
    limit: 100,
    format: { kind: 'percent' },
    resetsAt,
    ...(primary === undefined ? {} : { primary }),
  }
}

export function modelKeyMatches(model: string, key: string): boolean {
  let idx = model.indexOf(key)
  while (idx >= 0) {
    const before = idx === 0 ? '' : model[idx - 1]
    const rest = model.slice(idx + key.length)
    // A trailing ".N" is a version continuation ("gpt-5" must not claim "gpt-5.6"),
    // not a word boundary like "-codex" or end-of-string.
    const versionContinues = rest[0] === '.' && /\d/.test(rest[1] ?? '')
    if ((!before || !/[a-z0-9-]/.test(before)) && !versionContinues && (rest === '' || rest[0] === '-' || !/[a-z0-9]/.test(rest[0]))) {
      return true
    }
    idx = model.indexOf(key, idx + key.length)
  }
  return false
}

export const dollars = (cents: number): number => finite(cents) / 100
