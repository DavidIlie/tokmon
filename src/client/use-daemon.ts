import { useEffect, useMemo, useRef, useState } from 'react'
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

export function useDaemon(baseUrl: string | null): UseDaemon {
  const [snapshot, setSnapshot] = useState<WebSnapshot | null>(null)
  const [conn, setConn] = useState<ConnState>('connecting')
  const [config, setConfigState] = useState<ConfigState | null>(null)

  const client = useMemo(() => {
    if (!baseUrl) return null
    return createDaemonRpcClient(baseUrl, {
      transport: 'node',
      onConn: (state) => {
        if (state !== 'closed') setConn(state)
      },
    })
  }, [baseUrl])
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
