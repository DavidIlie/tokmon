import { useState, useEffect, useRef } from 'react'
import { fetchPeak, type PeakStatus } from '../../peak'
import { PROVIDERS, type Account } from '../../providers'
import { loadSeedSnapshot } from '../../client/seed-cache'
import { upsert } from '../../app.logic'
import type { AccountStats } from '../../stats'

export function useDegradedPolling({ degraded, configReady, showPicker, accountsKey, accountsRef, interval, billingMs, tz }: {
  degraded: boolean
  configReady: boolean
  showPicker: boolean
  accountsKey: string
  accountsRef: { current: Account[] }
  interval: number
  billingMs: number
  tz: string
}): {
  statsLocal: Map<string, AccountStats>
  peakLocal: PeakStatus | null
  updatedLocal: Date
  error: string | null
} {
  const [statsLocal, setStats] = useState<Map<string, AccountStats>>(new Map())
  const [peakLocal, setPeak] = useState<PeakStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedLocal, setUpdated] = useState(new Date())
  const seededRef = useRef(false)

  useEffect(() => {
    if (!degraded) return
    if (seededRef.current || !configReady || showPicker || accountsRef.current.length === 0) return
    seededRef.current = true
    loadSeedSnapshot().then(snap => {
      setStats(prev => {
        if (prev.size > 0) return prev
        const next = new Map(prev)
        for (const acc of accountsRef.current) {
          const s = snap[acc.id]
          if (s && (s.dashboard || s.billing)) next.set(acc.id, { account: acc, dashboard: s.dashboard ?? null, billing: s.billing ?? null })
        }
        return next
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [degraded, configReady, showPicker, accountsKey])

  useEffect(() => {
    if (!degraded || !configReady || showPicker) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        await Promise.all(accountsRef.current.map(async (acc) => {
          const provider = PROVIDERS[acc.providerId]
          if (!provider.hasUsage || !provider.fetchSummary) return
          try {
            const dashboard = await provider.fetchSummary(acc, tz)
            if (active) setStats(prev => upsert(prev, acc, { dashboard }))
          } catch {}
        }))
        if (active) { setError(null); setUpdated(new Date()) }
      } finally {
        if (active) timer = setTimeout(load, interval)
      }
    }
    load()
    return () => { active = false; clearTimeout(timer) }
  }, [degraded, interval, tz, configReady, showPicker, accountsKey])

  useEffect(() => {
    if (!degraded || !configReady || showPicker) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const peakP = accountsRef.current.some(a => a.providerId === 'claude')
          ? fetchPeak() : Promise.resolve(null)
        await Promise.all(accountsRef.current.map(async (acc) => {
          const provider = PROVIDERS[acc.providerId]
          if (!provider.hasBilling || !provider.fetchBilling) return
          try {
            const billing = await provider.fetchBilling(acc, tz)
            if (active) setStats(prev => upsert(prev, acc, { billing }))
          } catch {}
        }))
        const p = await peakP
        if (active && p) setPeak(p)
      } finally {
        if (active) timer = setTimeout(load, billingMs)
      }
    }
    load()
    return () => { active = false; clearTimeout(timer) }
  }, [degraded, billingMs, tz, configReady, showPicker, accountsKey])

  return { statsLocal, peakLocal, updatedLocal, error }
}
