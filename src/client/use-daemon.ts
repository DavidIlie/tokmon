import { useEffect, useMemo, useRef, useState } from 'react'
// (attachOrSpawn is imported lazily inside the reacquire effect, keeping
// child_process/spawn out of this module's static graph.)
import type { Config, WebSnapshot } from '../web/contract'
import {
  createDaemonRpcClient,
  type DaemonRpcClient,
  type RpcConnState,
} from './daemon-rpc-client'
import type { ConfigState, FsListing, RefreshScope } from '../rpc/contract'

export type ConnState = Exclude<RpcConnState, 'closed'>

export interface UseDaemon {
  snapshot: WebSnapshot | null
  conn: ConnState
  setConfig: (next: Config, expectedRevision: number) => Promise<ConfigState>
  refresh: (scope?: RefreshScope) => Promise<void>
  browse: (path: string) => Promise<FsListing>
  config: ConfigState | null
}

/** How long the TUI tolerates a dead transport before re-reading the lockfile. */
const REACQUIRE_AFTER_MS = 15_000

export function useDaemon(baseUrl: string | null): UseDaemon {
  const [snapshot, setSnapshot] = useState<WebSnapshot | null>(null)
  const [conn, setConn] = useState<ConnState>('connecting')
  const [config, setConfigState] = useState<ConfigState | null>(null)
  // The startup baseUrl freezes the daemon's port. When that daemon is retired
  // (a newer CLI took over) or restarted on another port, reconnecting to the
  // old URL can never succeed — follow the lockfile to the live owner instead.
  const [activeUrl, setActiveUrl] = useState(baseUrl)
  const reacquiring = useRef(false)
  useEffect(() => { setActiveUrl(baseUrl) }, [baseUrl])

  useEffect(() => {
    if (!activeUrl || conn === 'live' || conn === 'connecting') return
    const timer = setTimeout(() => {
      if (reacquiring.current) return
      reacquiring.current = true
      void import('./daemon-handle')
        .then(({ attachOrSpawn }) => attachOrSpawn())
        .then(handle => {
          if (handle.kind === 'spawned' && handle.baseUrl && handle.baseUrl !== activeUrl) {
            setActiveUrl(handle.baseUrl)
          }
        })
        .catch(() => {})
        .finally(() => { reacquiring.current = false })
    }, REACQUIRE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [activeUrl, conn])

  const client = useMemo(() => {
    if (!activeUrl) return null
    return createDaemonRpcClient(activeUrl, {
      transport: 'node',
      onConn: (state) => {
        if (state !== 'closed') setConn(state)
      },
    })
  }, [activeUrl])
  const clientRef = useRef(client)
  clientRef.current = client

  useEffect(() => {
    if (!client) return
    const unsubSnapshot = client.subscribeSnapshot(setSnapshot)
    const unsubConfig = client.subscribeConfig(setConfigState)
    return () => {
      unsubSnapshot()
      unsubConfig()
      void client.close()
    }
  }, [client])

  const requireClient = (): DaemonRpcClient => {
    if (!clientRef.current) throw new Error('daemon RPC client is unavailable')
    return clientRef.current
  }

  return {
    snapshot,
    conn,
    config,
    setConfig: (next, expectedRevision) => requireClient().setConfig({ config: next, expectedRevision }),
    refresh: (scope) => requireClient().refresh(scope),
    browse: (path) => requireClient().browseFs(path),
  }
}
