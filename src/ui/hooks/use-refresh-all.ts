import { useCallback, useEffect, useRef, useState } from 'react'

export type RefreshStatus =
  | { phase: 'idle'; message: '' }
  | { phase: 'refreshing'; message: 'Refreshing all data' }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string }

const IDLE: RefreshStatus = { phase: 'idle', message: '' }
export const CONNECTED_REFRESH_TIMEOUT_MS = 10 * 60_000
const STATUS_TTL_MS = 4_000

export function awaitRefreshCompletion(
  request: () => Promise<void>,
  timeoutMs = CONNECTED_REFRESH_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`refresh is still running after ${Math.round(timeoutMs / 1000)} seconds; it may finish in the background`))
    }, timeoutMs)
    timer.unref?.()
    Promise.resolve()
      .then(request)
      .then(
        () => { clearTimeout(timer); resolve() },
        cause => { clearTimeout(timer); reject(cause) },
      )
  })
}

function errorText(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : 'refresh failed'
}

/** Coordinates the r/R shortcut without coupling key dispatch to transport details. */
export function useRefreshAll({
  connected,
  requestDaemonRefresh,
  requestDegradedRefresh,
}: {
  connected: boolean
  requestDaemonRefresh: () => Promise<void>
  requestDegradedRefresh: () => Promise<void>
}): { status: RefreshStatus; refreshAll: () => void } {
  const [status, setStatus] = useState<RefreshStatus>(IDLE)
  const flightRef = useRef<Promise<void> | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    }
  }, [])

  const refreshAll = useCallback(() => {
    if (flightRef.current) return
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    setStatus({ phase: 'refreshing', message: 'Refreshing all data' })

    const task = connected
      ? awaitRefreshCompletion(requestDaemonRefresh)
      : Promise.resolve().then(requestDegradedRefresh)

    const owned = task.then(() => {
      if (!mountedRef.current) return
      setStatus({
        phase: 'success',
        message: 'All data refreshed',
      })
    }).catch(cause => {
      if (!mountedRef.current) return
      setStatus({ phase: 'error', message: `Refresh failed: ${errorText(cause)}` })
    }).finally(() => {
      if (flightRef.current === owned) flightRef.current = null
      if (!mountedRef.current) return
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null
        if (mountedRef.current) setStatus(IDLE)
      }, STATUS_TTL_MS)
      clearTimerRef.current.unref?.()
    })
    flightRef.current = owned
  }, [connected, requestDaemonRefresh, requestDegradedRefresh])

  return { status, refreshAll }
}
