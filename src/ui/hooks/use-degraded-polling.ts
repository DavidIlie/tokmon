import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPeak, type PeakStatus } from '../../peak'
import { PROVIDERS, type Account, type ProviderId } from '../../providers'
import { coalesceTables } from '../../providers/usage-core'
import { loadSeedSnapshot } from '../../client/seed-cache'
import { upsert } from '../../app.logic'
import type { AccountStats } from '../../stats'
import type { TableData } from '../../types'
import { withTimeout } from '../../async'

type AccountsRef = { current: Account[] }

function failureMessage(scope: string, failures: PromiseRejectedResult[]): Error {
  const detail = failures[0]?.reason
  const suffix = detail instanceof Error && detail.message ? `: ${detail.message}` : ''
  return new Error(`${scope} refresh failed for ${failures.length} source${failures.length === 1 ? '' : 's'}${suffix}`)
}

function usageProviders(accounts: Account[]): ProviderId[] {
  return [...new Set(accounts.filter(account => PROVIDERS[account.providerId].hasUsage).map(account => account.providerId))]
}

/**
 * Whether the cached snapshot should be applied for the current collector epoch.
 *
 * The epoch advances — discarding every collected stat — whenever the account
 * set, the timezone or the degraded flag changes. Seeding is therefore armed
 * once per epoch rather than once per process: losing the daemon a second time
 * would otherwise paint an empty dashboard until the first live poll returned,
 * which is precisely what the cache exists to avoid. Re-seeding cannot clobber
 * fresher data, because the caller only applies it to an empty stats map.
 */
export function shouldSeedLocalStats(input: {
  seededEpoch: number | null
  epoch: number
  degraded: boolean
  configReady: boolean
  showPicker: boolean
  accountCount: number
}): boolean {
  if (!input.degraded || !input.configReady || input.showPicker) return false
  if (input.accountCount === 0) return false
  return input.seededEpoch !== input.epoch
}

/**
 * Owns every in-process collector. Scheduled polling and manual refreshes share
 * the same in-flight promises, so pressing r/R cannot start duplicate provider work.
 */
export function useDegradedPolling({
  degraded,
  configReady,
  showPicker,
  accountsKey,
  accountsRef,
  interval,
  billingMs,
  tz,
  activeTableProvider,
  tableVisible,
}: {
  degraded: boolean
  configReady: boolean
  showPicker: boolean
  accountsKey: string
  accountsRef: AccountsRef
  interval: number
  billingMs: number
  tz: string
  activeTableProvider: ProviderId | null
  tableVisible: boolean
}): {
  statsLocal: Map<string, AccountStats>
  peakLocal: PeakStatus | null
  updatedLocal: Date
  tableLocal: TableData | null
  tableLoading: boolean
  refreshAll: () => Promise<void>
} {
  const [statsLocal, setStats] = useState<Map<string, AccountStats>>(new Map())
  const [peakLocal, setPeak] = useState<PeakStatus | null>(null)
  const [updatedLocal, setUpdated] = useState(new Date())
  const [tables, setTables] = useState<Map<ProviderId, TableData>>(new Map())
  const [loadingTables, setLoadingTables] = useState<Set<ProviderId>>(new Set())
  const seededEpochRef = useRef<number | null>(null)
  const epochRef = useRef(0)
  const summaryFlightRef = useRef<Promise<void> | null>(null)
  const billingFlightRef = useRef<Promise<void> | null>(null)
  const peakFlightRef = useRef<Promise<void> | null>(null)
  const tableFlightsRef = useRef(new Map<ProviderId, Promise<void>>())
  const allFlightRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    const epoch = ++epochRef.current
    summaryFlightRef.current = null
    billingFlightRef.current = null
    peakFlightRef.current = null
    tableFlightsRef.current.clear()
    allFlightRef.current = null
    setStats(new Map())
    setTables(new Map())
    setLoadingTables(new Set())
    return () => {
      if (epochRef.current === epoch) epochRef.current++
    }
  }, [accountsKey, tz, degraded])

  useEffect(() => {
    const epoch = epochRef.current
    if (!shouldSeedLocalStats({
      seededEpoch: seededEpochRef.current, epoch,
      degraded, configReady, showPicker, accountCount: accountsRef.current.length,
    })) return
    seededEpochRef.current = epoch
    void loadSeedSnapshot().then(snap => {
      if (epoch !== epochRef.current) return
      setStats(prev => {
        if (prev.size > 0) return prev
        const next = new Map(prev)
        for (const acc of accountsRef.current) {
          const cached = snap[acc.id]
          if (cached && (cached.dashboard || cached.billing)) {
            next.set(acc.id, {
              account: acc,
              dashboard: cached.dashboard ?? null,
              billing: cached.billing ?? null,
            })
          }
        }
        return next
      })
    })
  }, [degraded, configReady, showPicker, accountsKey, tz, accountsRef])

  const runSummary = useCallback((): Promise<void> => {
    if (summaryFlightRef.current) return summaryFlightRef.current
    const epoch = epochRef.current
    const task = (async () => {
      const targets = accountsRef.current.filter(account => {
        const provider = PROVIDERS[account.providerId]
        return provider.hasUsage && provider.fetchSummary
      })
      const settled = await Promise.allSettled(targets.map(async account => {
        const fetchSummary = PROVIDERS[account.providerId].fetchSummary
        if (!fetchSummary) return
        const dashboard = await withTimeout(fetchSummary(account, tz))
        if (epoch === epochRef.current) setStats(prev => upsert(prev, account, { dashboard }))
      }))
      if (epoch !== epochRef.current) return
      setUpdated(new Date())
      const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failures.length > 0) throw failureMessage('summary', failures)
    })()
    const owned = task.finally(() => {
      if (summaryFlightRef.current === owned) summaryFlightRef.current = null
    })
    summaryFlightRef.current = owned
    return owned
  }, [accountsKey, accountsRef, tz])

  const runBilling = useCallback((): Promise<void> => {
    if (billingFlightRef.current) return billingFlightRef.current
    const epoch = epochRef.current
    const task = (async () => {
      const targets = accountsRef.current.filter(account => {
        const provider = PROVIDERS[account.providerId]
        return provider.hasBilling && provider.fetchBilling
      })
      const settled = await Promise.allSettled(targets.map(async account => {
        const fetchBilling = PROVIDERS[account.providerId].fetchBilling
        if (!fetchBilling) return
        const billing = await withTimeout(fetchBilling(account, tz))
        if (epoch === epochRef.current) setStats(prev => upsert(prev, account, { billing }))
      }))
      if (epoch !== epochRef.current) return
      const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failures.length > 0) throw failureMessage('billing', failures)
    })()
    const owned = task.finally(() => {
      if (billingFlightRef.current === owned) billingFlightRef.current = null
    })
    billingFlightRef.current = owned
    return owned
  }, [accountsKey, accountsRef, tz])

  const runPeak = useCallback((): Promise<void> => {
    if (peakFlightRef.current) return peakFlightRef.current
    if (!accountsRef.current.some(account => account.providerId === 'claude')) return Promise.resolve()
    const epoch = epochRef.current
    const task = withTimeout(fetchPeak()).then(peak => {
      if (epoch === epochRef.current && peak) setPeak(peak)
    })
    const owned = task.finally(() => {
      if (peakFlightRef.current === owned) peakFlightRef.current = null
    })
    peakFlightRef.current = owned
    return owned
  }, [accountsKey, accountsRef])

  const runTable = useCallback((providerId: ProviderId): Promise<void> => {
    const existing = tableFlightsRef.current.get(providerId)
    if (existing) return existing
    const epoch = epochRef.current
    const targets = accountsRef.current.filter(account => account.providerId === providerId)
    if (targets.length === 0 || !PROVIDERS[providerId].hasUsage) return Promise.resolve()

    setLoadingTables(prev => new Set(prev).add(providerId))
    const task = (async () => {
      const settled = await Promise.allSettled(targets.map(async account => {
        const fetchTable = PROVIDERS[account.providerId].fetchTable
        return fetchTable ? withTimeout(fetchTable(account, tz)) : null
      }))
      if (epoch !== epochRef.current) return
      const valid = settled.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
      if (valid.length > 0) {
        setTables(prev => new Map(prev).set(providerId, coalesceTables(valid)))
      }
      const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failures.length > 0) throw failureMessage(`${PROVIDERS[providerId].name} history`, failures)
    })()
    const owned = task.finally(() => {
      if (tableFlightsRef.current.get(providerId) !== owned) return
      tableFlightsRef.current.delete(providerId)
      setLoadingTables(prev => {
        if (!prev.has(providerId)) return prev
        const next = new Set(prev)
        next.delete(providerId)
        return next
      })
    })
    tableFlightsRef.current.set(providerId, owned)
    return owned
  }, [accountsKey, accountsRef, tz])

  const refreshAll = useCallback((): Promise<void> => {
    if (allFlightRef.current) return allFlightRef.current
    const tasks = [runSummary(), runBilling(), runPeak()]
    for (const providerId of usageProviders(accountsRef.current)) tasks.push(runTable(providerId))
    const task = Promise.allSettled(tasks).then(settled => {
      const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failures.length > 0) throw failureMessage('all-data', failures)
      setUpdated(new Date())
    })
    const owned = task.finally(() => {
      if (allFlightRef.current === owned) allFlightRef.current = null
    })
    allFlightRef.current = owned
    return owned
  }, [accountsRef, runBilling, runPeak, runSummary, runTable])

  useEffect(() => {
    if (!degraded || !configReady || showPicker) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const loop = async () => {
      await runSummary().catch(() => {})
      if (active) timer = setTimeout(loop, interval)
    }
    void loop()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [degraded, configReady, showPicker, interval, runSummary])

  useEffect(() => {
    if (!degraded || !configReady || showPicker) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const loop = async () => {
      await Promise.allSettled([runBilling(), runPeak()])
      if (active) timer = setTimeout(loop, billingMs)
    }
    void loop()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [degraded, configReady, showPicker, billingMs, runBilling, runPeak])

  useEffect(() => {
    if (!degraded || !configReady || showPicker || !tableVisible || !activeTableProvider) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const loop = async () => {
      await runTable(activeTableProvider).catch(() => {})
      if (active) timer = setTimeout(loop, Math.max(interval, 10_000))
    }
    void loop()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [degraded, configReady, showPicker, tableVisible, activeTableProvider, interval, runTable])

  return {
    statsLocal,
    peakLocal,
    updatedLocal,
    tableLocal: activeTableProvider ? (tables.get(activeTableProvider) ?? null) : null,
    tableLoading: activeTableProvider ? loadingTables.has(activeTableProvider) : false,
    refreshAll,
  }
}
