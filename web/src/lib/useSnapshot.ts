import { useEffect, useRef, useState } from 'react'
import type { WebSnapshot } from '@shared'

export type ConnState = 'connecting' | 'live' | 'reconnecting' | 'error'

export interface SnapshotState {
  snapshot: WebSnapshot | null
  conn: ConnState
  receivedAt: number | null
}

export function useSnapshot(): SnapshotState {
  const [snapshot, setSnapshot] = useState<WebSnapshot | null>(null)
  const [conn, setConn] = useState<ConnState>('connecting')
  const [receivedAt, setReceivedAt] = useState<number | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined

    fetch('/api/data')
      .then(r => r.json())
      .then((d: WebSnapshot | { pending: boolean }) => {
        if (cancelled || !d || 'pending' in d) return
        setSnapshot(d as WebSnapshot)
        setReceivedAt(Date.now())
      })
      .catch(() => {})

    // Native EventSource retries transient drops; if it hard-CLOSES we rebuild it
    // ourselves after a short backoff, keeping the last snapshot visible meanwhile.
    const connect = () => {
      const es = new EventSource('/api/stream')
      esRef.current = es
      es.onopen = () => { if (!cancelled) setConn('live') }
      es.addEventListener('snapshot', (ev: MessageEvent) => {
        if (cancelled) return
        try {
          setSnapshot(JSON.parse(ev.data) as WebSnapshot)
          setReceivedAt(Date.now())
          setConn('live')
        } catch {}
      })
      es.onerror = () => {
        if (cancelled) return
        if (es.readyState === EventSource.CLOSED) {
          setConn('error')
          es.close()
          retry = setTimeout(() => { if (!cancelled) { setConn('reconnecting'); connect() } }, 3000)
        } else {
          setConn('reconnecting')
        }
      }
    }
    connect()

    return () => { cancelled = true; clearTimeout(retry); esRef.current?.close(); esRef.current = null }
  }, [])

  return { snapshot, conn, receivedAt }
}
