import { Cause, Context, Duration, Effect, Fiber, Layer, ManagedRuntime, Schedule, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import type { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as Socket from 'effect/unstable/socket/Socket'
import type { Config, WebSnapshot } from '../web/contract'
import {
  TOKMON_WS_METHODS,
  TOKMON_WS_PATH,
  TokmonRpcGroup,
  type FsListing,
  type RefreshScope,
} from '../rpc/contract'

export type RpcConnState = 'connecting' | 'live' | 'reconnecting' | 'error' | 'closed'

export interface DaemonRpcClientOptions {
  readonly wsToken?: string
  readonly transport?: 'auto' | 'node' | 'browser'
  readonly reconnectAttempts?: number
  readonly reconnectBaseDelayMs?: number
  readonly onConn?: (state: RpcConnState, error?: unknown) => void
}

export interface DaemonRpcClient {
  getConfig(): Promise<Config>
  setConfig(config: Config): Promise<Config>
  refresh(scope?: RefreshScope): Promise<void>
  browseFs(path: string): Promise<FsListing>
  subscribeSnapshot(onSnapshot: (snapshot: WebSnapshot) => void): () => void
  subscribeConfig(onConfig: (config: Config) => void): () => void
  close(): Promise<void>
}

type NodeSocketModule = typeof import('@effect/platform-node/NodeSocket')
type TokmonRpcs = RpcGroup.Rpcs<typeof TokmonRpcGroup>
type TokmonClient = RpcClient.RpcClient<TokmonRpcs, RpcClientError>

class TokmonRpcClient extends Context.Service<TokmonRpcClient, TokmonClient>()(
  'tokmon/client/DaemonRpcClient/TokmonRpcClient',
) {}

type TokmonRuntime = ManagedRuntime.ManagedRuntime<TokmonRpcClient, never>

interface Session {
  readonly runtime: TokmonRuntime
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>

function toWsUrl(baseUrl: string, token: string | undefined): string {
  const base = typeof window === 'undefined' ? undefined : window.location.origin
  const url = new URL(baseUrl, base)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  else if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`unsupported daemon RPC protocol: ${url.protocol}`)
  }
  url.pathname = TOKMON_WS_PATH
  if (token) url.searchParams.set('wsToken', token)
  return url.toString()
}

function shouldUseNodeTransport(transport: DaemonRpcClientOptions['transport']): boolean {
  if (transport === 'node') return true
  if (transport === 'browser') return false
  return typeof window === 'undefined'
}

async function socketLayerFor(
  url: string,
  transport: DaemonRpcClientOptions['transport'],
): Promise<Layer.Layer<Socket.Socket>> {
  if (shouldUseNodeTransport(transport)) {
    const NodeSocket = await dynamicImport<NodeSocketModule>('@effect/platform-node/NodeSocket')
    return NodeSocket.layerWebSocket(url)
  }
  return Socket.layerWebSocket(url).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  )
}

function retryPolicy(options: DaemonRpcClientOptions) {
  const baseDelay = options.reconnectBaseDelayMs ?? 250
  const policy = Schedule.exponential(Duration.millis(baseDelay), 1.5).pipe(
    Schedule.either(Schedule.spaced(Duration.millis(2_500))),
  )
  return typeof options.reconnectAttempts === 'number'
    ? policy.pipe(Schedule.both(Schedule.recurs(options.reconnectAttempts)))
    : policy
}

export function createDaemonRpcClient(baseUrl: string, options: DaemonRpcClientOptions = {}): DaemonRpcClient {
  const url = toWsUrl(baseUrl, options.wsToken)
  const fibers = new Set<Fiber.Fiber<unknown, unknown>>()
  let session: Session | null = null
  let sessionPromise: Promise<Session> | null = null
  let closed = false

  const setConn = (state: RpcConnState, error?: unknown) => {
    options.onConn?.(state, error)
  }

  const resetSession = (active?: Session | null) => {
    const dead = active ?? session
    if (active === undefined || active === session) session = null
    sessionPromise = null
    if (dead) void dead.runtime.dispose().catch(() => {})
  }

  const makeProtocolLayer = async () => {
    const socketLayer = await socketLayerFor(url, options.transport)
    const connectionHooksLayer = Layer.succeed(
      RpcClient.ConnectionHooks,
      RpcClient.ConnectionHooks.of({
        onConnect: Effect.sync(() => { setConn('live') }),
        onDisconnect: Effect.sync(() => {
          if (!closed) {
            setConn('reconnecting')
            resetSession()
          }
        }),
      }),
    )
    return Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        retryPolicy: retryPolicy(options),
        retryTransientErrors: true,
      }),
    ).pipe(
      Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson, connectionHooksLayer)),
    )
  }

  const ensureSession = async (): Promise<Session> => {
    if (closed) throw new Error('daemon RPC client is closed')
    if (session) return session
    if (sessionPromise) return sessionPromise

    setConn('connecting')
    sessionPromise = (async () => {
      let runtime: TokmonRuntime | undefined
      try {
        const protocolLayer = await makeProtocolLayer()
        const clientLayer = Layer.effect(
          TokmonRpcClient,
          RpcClient.make(TokmonRpcGroup),
        ).pipe(
          Layer.provide(protocolLayer),
        )
        runtime = ManagedRuntime.make(clientLayer)
        await runtime.runPromise(TokmonRpcClient.asEffect())
        if (closed) {
          await runtime.dispose()
          throw new Error('daemon RPC client is closed')
        }
        session = { runtime }
        return session
      } catch (error) {
        sessionPromise = null
        await runtime?.dispose().catch(() => {})
        if (!closed) setConn('error', error)
        throw error
      }
    })()

    return sessionPromise
  }

  const run = async <A>(effectFor: (client: TokmonClient) => Effect.Effect<A, unknown>): Promise<A> => {
    const active = await ensureSession()
    try {
      return await active.runtime.runPromise(
        TokmonRpcClient.use((client) => effectFor(client)),
      )
    } catch (error) {
      if (!closed) {
        resetSession(active)
        setConn('error', error)
      }
      throw error
    }
  }

  const subscribe = <A>(
    streamFor: (client: TokmonClient) => Stream.Stream<A, unknown>,
    onValue: (value: A) => void,
  ): (() => void) => {
    if (closed) return () => {}
    let fiber: Fiber.Fiber<unknown, unknown> | null = null
    let unsubscribed = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const stopFiber = () => {
      if (!fiber) return
      const current = fiber
      fiber = null
      fibers.delete(current)
      void (session?.runtime.runPromise(Fiber.interrupt(current)) ?? Effect.runPromise(Fiber.interrupt(current))).catch(() => {})
    }

    const scheduleRetry = () => {
      if (closed || unsubscribed || retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        start()
      }, options.reconnectBaseDelayMs ?? 250)
      retryTimer.unref?.()
    }

    const start = () => { void (async () => {
      try {
        const active = await ensureSession()
        if (closed || unsubscribed) return
        fiber = active.runtime.runFork(
          TokmonRpcClient.use((client) =>
            streamFor(client).pipe(
              Stream.runForEach((value) =>
                Effect.sync(() => {
                  try { onValue(value) } catch {}
                }),
              ),
            ),
          ).pipe(Effect.catchCause((cause) =>
            Effect.sync(() => {
              if (!closed && !unsubscribed) {
                resetSession(active)
                setConn('error', Cause.squash(cause))
                scheduleRetry()
              }
            }),
          )),
        )
        fibers.add(fiber)
        fiber.addObserver(() => {
          if (fiber) fibers.delete(fiber)
        })
      } catch (error) {
        if (!closed && !unsubscribed) {
          resetSession()
          setConn('error', error)
          scheduleRetry()
        }
      }
    })() }

    start()

    return () => {
      unsubscribed = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      stopFiber()
    }
  }

  return {
    getConfig: () =>
      run((client) => client[TOKMON_WS_METHODS.getConfig]({})),

    setConfig: (config) =>
      run((client) => client[TOKMON_WS_METHODS.setConfig](config)),

    refresh: (scope = 'all') =>
      run((client) => client[TOKMON_WS_METHODS.refresh]({ scope })),

    browseFs: (path) =>
      run((client) => client[TOKMON_WS_METHODS.browseFs]({ path })),

    subscribeSnapshot: (onSnapshot) =>
      subscribe((client) => client[TOKMON_WS_METHODS.snapshot]({}), onSnapshot),

    subscribeConfig: (onConfig) =>
      subscribe((client) => client[TOKMON_WS_METHODS.config]({}), onConfig),

    async close() {
      if (closed) return
      closed = true
      setConn('closed')
      const active = [...fibers]
      fibers.clear()
      const activeSession = session ?? await sessionPromise?.catch(() => null) ?? null
      await Promise.all(active.map((fiber) =>
        (activeSession?.runtime.runPromise(Fiber.interrupt(fiber)) ?? Effect.runPromise(Fiber.interrupt(fiber))).catch(() => {}),
      ))
      session = null
      sessionPromise = null
      if (activeSession) {
        await activeSession.runtime.dispose().catch(() => {})
      }
    },
  }
}
