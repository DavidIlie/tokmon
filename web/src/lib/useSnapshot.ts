import { useEffect, useRef, useState } from 'react'
import type { WebSnapshot } from '@shared'
import {
  daemonRpcClient,
  shouldConnectBrowserAccess,
  subscribeRpcConnection,
  verifyBrowserAccess,
} from './rpc-client'

export type ConnState = 'connecting' | 'live' | 'reconnecting' | 'error' | 'auth-required' | 'unavailable'

export interface SnapshotState {
  snapshot: WebSnapshot | null
  conn: ConnState
}

export function useSnapshot(): SnapshotState {
  const [snapshot, setSnapshot] = useState<WebSnapshot | null>(null)
  const [conn, setConn] = useState<ConnState>('connecting')
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubConn: (() => void) | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const connect = async (): Promise<void> => {
      const access = await verifyBrowserAccess()
      if (cancelled) return
      if (access === 'missing-token' || access === 'expired-token') {
        setConn('auth-required')
        return
      }
      if (!shouldConnectBrowserAccess(access)) {
        setConn('unavailable')
        retryTimer = setTimeout(() => { void connect() }, 2_500)
        return
      }

      const client = daemonRpcClient()
      unsubConn = subscribeRpcConnection((state) => {
        if (!cancelled) setConn(state)
      })
      unsubRef.current = client.subscribeSnapshot((next) => {
        if (cancelled) return
        setSnapshot(next)
        setConn('live')
      })
    }
    void connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      unsubConn?.()
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [])

  return { snapshot, conn }
}
