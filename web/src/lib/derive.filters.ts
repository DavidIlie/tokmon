import type { WebSnapshot, WebAccount } from '@shared'
import { DAY, fmtDay, parseDay, todayInTz } from './date'

export type PeriodKey = '7d' | '30d' | '90d' | 'mtd' | '6m' | 'all'
export type Granularity = 'daily' | 'weekly' | 'monthly'

export interface Filters {
  providers: string[]
  models: string[]
  account: string
  period: PeriodKey
}

export const DEFAULT_FILTERS: Filters = {
  providers: [],
  models: [],
  account: 'all',
  period: '6m',
}

export const PERIODS: { key: PeriodKey; label: string; shortLabel: string }[] = [
  { key: '7d', label: '7 days', shortLabel: '7d' },
  { key: '30d', label: '30 days', shortLabel: '30d' },
  { key: '90d', label: '90 days', shortLabel: '90d' },
  { key: 'mtd', label: 'month to date', shortLabel: 'MTD' },
  { key: '6m', label: '6 months', shortLabel: '6M' },
  { key: 'all', label: 'all time', shortLabel: 'All' },
]

export function activeProviderFilter(f: Filters): Set<string> | null {
  return f.providers.length ? new Set(f.providers) : null
}

export function selectAccounts(snap: WebSnapshot, f: Filters): WebAccount[] {
  const provFilter = activeProviderFilter(f)
  return snap.accounts.filter(a => {
    if (!a.hasUsage) return false
    if (f.account !== 'all' && a.id !== f.account) return false
    if (provFilter && !provFilter.has(a.providerId)) return false
    return true
  })
}

export function hasBillingSignal(a: WebAccount): boolean {
  return !!(a.hasBilling && (
    a.billing?.metrics?.length || a.billing?.plan || a.billing?.error ||
    a.billing?.activity?.series?.length || a.billing?.modelSpend?.length
  ))
}

export function selectCardAccounts(snap: WebSnapshot, f: Filters): WebAccount[] {
  const provFilter = activeProviderFilter(f)
  return snap.accounts.filter(a => {
    if (!a.hasUsage && !hasBillingSignal(a)) return false
    if (f.account !== 'all' && a.id !== f.account) return false
    if (provFilter && !provFilter.has(a.providerId)) return false
    return true
  })
}

export function latestDayOf(accounts: WebAccount[]): string | null {
  let latest: string | null = null
  for (const a of accounts) {
    for (const r of a.table?.daily ?? []) {
      if (!latest || r.label > latest) latest = r.label
    }
  }
  return latest
}

export function rangeStartOf(period: PeriodKey, latest: string | null, tz: string): string | null {
  if (!latest || period === 'all') return null
  if (period === 'mtd') return todayInTz(tz).slice(0, 7) + '-01'
  if (period === '6m') {
    const date = new Date(parseDay(latest))
    const month = date.getUTCMonth() - 6
    const year = date.getUTCFullYear() + Math.floor(month / 12)
    const normalizedMonth = ((month % 12) + 12) % 12
    const lastDay = new Date(Date.UTC(year, normalizedMonth + 1, 0)).getUTCDate()
    return fmtDay(Date.UTC(year, normalizedMonth, Math.min(date.getUTCDate(), lastDay)))
  }
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30
  return fmtDay(parseDay(latest) - (days - 1) * DAY)
}

export function granRangeStart(period: PeriodKey, gran: Granularity, latest: string | null, tz: string): string | null {
  if (!latest || period === 'all') return null
  const periodStart = rangeStartOf(period, latest, tz)
  if (gran === 'daily') return periodStart
  const floorDays = gran === 'monthly' ? 365 : 84
  const floorStart = fmtDay(parseDay(latest) - (floorDays - 1) * DAY)
  return periodStart && periodStart < floorStart ? periodStart : floorStart
}
