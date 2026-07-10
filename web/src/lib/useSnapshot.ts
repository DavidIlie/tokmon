import { useEffect, useRef, useState } from 'react'
import type { WebSnapshot } from '@shared'
import {
  daemonRpcClient,
  subscribeRpcConnection,
} from './rpc-client'

export type ConnState = 'connecting' | 'live' | 'reconnecting' | 'error'

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
    const client = daemonRpcClient()
    unsubConn = subscribeRpcConnection((state) => {
      if (!cancelled) setConn(state)
    })
    unsubRef.current = client.subscribeSnapshot((next) => {
      if (cancelled) return
      setSnapshot(next)
      setConn('live')
    })

    return () => {
      cancelled = true
      unsubConn?.()
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [])

  return { snapshot, conn }
}
