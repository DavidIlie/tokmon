import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_FILTERS, type Filters, type PeriodKey } from './derive'

const PERIODS = new Set<PeriodKey>(['7d', '30d', '90d', 'mtd', 'all'])

function parse(search: string): Filters {
  const q = new URLSearchParams(search)
  const list = (k: string) => (q.get(k) ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const period = q.get('period') as PeriodKey | null
  return {
    providers: list('p'),
    models: list('m'),
    account: q.get('a') || 'all',
    period: period && PERIODS.has(period) ? period : DEFAULT_FILTERS.period,
  }
}

function serialize(f: Filters): string {
  const q = new URLSearchParams()
  if (f.providers.length) q.set('p', f.providers.join(','))
  if (f.models.length) q.set('m', f.models.join(','))
  if (f.account !== 'all') q.set('a', f.account)
  if (f.period !== DEFAULT_FILTERS.period) q.set('period', f.period)
  const s = q.toString()
  // Preserve the active tab (hash) so filter changes never drop it.
  return (s ? `?${s}` : location.pathname) + location.hash
}

export function useFilters(): [Filters, (next: Filters | ((p: Filters) => Filters)) => void] {
  const [filters, setFiltersState] = useState<Filters>(() => parse(location.search))

  useEffect(() => {
    const onPop = () => setFiltersState(parse(location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const setFilters = useCallback((next: Filters | ((p: Filters) => Filters)) => {
    setFiltersState(prev => {
      const value = typeof next === 'function' ? (next as (p: Filters) => Filters)(prev) : next
      const url = serialize(value)
      window.history.replaceState(null, '', url)
      return value
    })
  }, [])

  return [filters, setFilters]
}
