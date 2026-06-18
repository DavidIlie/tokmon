import { useCallback, useMemo } from 'react'
import { parseAsArrayOf, parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs'
import { DEFAULT_FILTERS, type Filters, type PeriodKey } from './derive'

const PERIODS: PeriodKey[] = ['7d', '30d', '90d', 'mtd', 'all']

export function useFilters(): [Filters, (next: Filters | ((p: Filters) => Filters)) => void] {
  const [s, setS] = useQueryStates(
    {
      p: parseAsArrayOf(parseAsString).withDefault([]),
      m: parseAsArrayOf(parseAsString).withDefault([]),
      a: parseAsString.withDefault('all'),
      period: parseAsStringEnum(PERIODS).withDefault(DEFAULT_FILTERS.period),
    },
    { history: 'replace' },
  )

  const filters = useMemo<Filters>(
    () => ({ providers: s.p, models: s.m, account: s.a, period: s.period }),
    [s.p, s.m, s.a, s.period],
  )

  const setFilters = useCallback((next: Filters | ((p: Filters) => Filters)) => {
    void setS(prev => {
      const cur: Filters = { providers: prev.p, models: prev.m, account: prev.a, period: prev.period }
      const v = typeof next === 'function' ? (next as (p: Filters) => Filters)(cur) : next
      return { p: v.providers, m: v.models, a: v.account, period: v.period }
    })
  }, [setS])

  return [filters, setFilters]
}
