import { Cause, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, ManagedRuntime, Schedule, Schema, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import { RpcClientError } from 'effect/unstable/rpc/RpcClientError'
import type * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import * as Socket from 'effect/unstable/socket/Socket'
import { normalizeConfig } from '../config-schema'
import type { WebSnapshot } from '../web/contract'
import {
  ConfigStateSchema,
  ConfigUpdateConflictFailure,
  TYPED_READ_FAILURES_CAPABILITY,
  TOKMON_WS_METHODS,
  TOKMON_WS_PATH,
  TokmonRpcGroup,
  type ConfigState,
  type ConfigUpdateRequest,
  type FsListing,
  type RefreshScope,
} from '../rpc/contract'
import { materializeWebSnapshot } from '../web/snapshot-schema'

export type RpcConnState = 'connecting' | 'live' | 'reconnecting' | 'error' | 'closed'

export interface DaemonRpcClientOptions {
  readonly transport?: 'auto' | 'node' | 'browser'
  /** Maximum supervisor retries after the initial connection attempt. */
  readonly reconnectAttempts?: number
  readonly reconnectBaseDelayMs?: number
  readonly requestTimeoutMs?: number
  readonly snapshotStaleFloorMs?: number
  readonly onConn?: (state: RpcConnState, error?: unknown) => void
  readonly onSubscriberError?: (error: unknown) => void
}

export interface DaemonRpcClient {
  getConfig(): Promise<ConfigState>
  setConfig(update: ConfigUpdateRequest): Promise<ConfigState>
  refresh(scope?: RefreshScope): Promise<void>
  browseFs(path: string): Promise<FsListing>
  subscribeSnapshot(onSnapshot: (snapshot: WebSnapshot) => void): () => void
  subscribeConfig(onConfig: (config: ConfigState) => void): () => void
  close(): Promise<void>
}

export class DaemonRpcConnectionError extends Error {
  constructor(message = 'daemon RPC connection closed') {
    super(message)
    this.name = 'DaemonRpcConnectionError'
  }
}

export class DaemonRpcRequestTimeoutError extends Error {
  constructor(readonly method: string, readonly timeoutMs: number) {
    super(`${method} timed out after ${timeoutMs}ms`)
    this.name = 'DaemonRpcRequestTimeoutError'
  }
}

type NodeSocketModule = typeof import('@effect/platform-node/NodeSocket')
type TokmonRpcs = RpcGroup.Rpcs<typeof TokmonRpcGroup>
type TokmonClient = RpcClient.RpcClient<TokmonRpcs, RpcClientError>
type WireConfigState = typeof ConfigStateSchema.Type

class TokmonRpcClient extends Context.Service<TokmonRpcClient, TokmonClient>()(
  'tokmon/client/DaemonRpcClient/TokmonRpcClient',
) {}

type TokmonRuntime = ManagedRuntime.ManagedRuntime<TokmonRpcClient, never>

interface Session {
  readonly runtime: TokmonRuntime
  readonly disconnected: Deferred.Deferred<DaemonRpcConnectionError>
  invalidated: boolean
}

interface Subscription<A> {
  readonly streamFor: (client: TokmonClient) => Stream.Stream<A, unknown>
  readonly onValue: (value: A) => void
  readonly staleAfterFor?: (value: A) => number
  active: boolean
  fiber: Fiber.Fiber<unknown, unknown> | null
  owner: Session | null
  watchdogFiber: Fiber.Fiber<unknown, unknown> | null
  lastValueAt: number
  staleAfterMs: number
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>

/** Run an effect, rejecting with the raw failure so `instanceof` checks on
 * DaemonRpcConnectionError / RpcClientError keep working at the Promise seam. */
function runOrThrow<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
  })
}

function interruptFiber(fiber: Fiber.Fiber<unknown, unknown> | null): Promise<void> {
  return fiber
    ? Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined, () => undefined)
    : Promise.resolve()
}

function toWsUrl(baseUrl: string): string {
  const base = typeof window === 'undefined' ? undefined : window.location.origin
  const url = new URL(baseUrl, base)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  else if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`unsupported daemon RPC protocol: ${url.protocol}`)
  }
  url.hash = ''
  url.searchParams.delete('tokmonToken')
  url.searchParams.delete('wsToken')
  url.pathname = TOKMON_WS_PATH
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
  openTimeoutMs: number,
): Promise<Layer.Layer<Socket.Socket>> {
  const socketOptions = { openTimeout: Duration.millis(openTimeoutMs) }
  if (shouldUseNodeTransport(transport)) {
    const NodeSocket = await dynamicImport<NodeSocketModule>('@effect/platform-node/NodeSocket')
    return NodeSocket.layerWebSocket(url, socketOptions)
  }
  return Socket.layerWebSocket(url, socketOptions).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  )
}

function normalizeConfigState(state: WireConfigState): ConfigState {
  return {
    protocol: {
      version: state.protocol.version,
      capabilities: [...state.protocol.capabilities],
    },
    config: normalizeConfig(state.config),
  }
}

function normalizeRequestFailure(error: unknown): unknown {
  if (!error || typeof error !== 'object' || (error as { kind?: unknown }).kind !== 'conflict') return error
  const state = (error as { state?: WireConfigState }).state
  if (!state) return error
  const normalized = normalizeConfigState(state)
  if (error instanceof ConfigUpdateConflictFailure) {
    return new ConfigUpdateConflictFailure({ kind: 'conflict', state: normalized })
  }
  return { ...error, state: normalized }
}

function isSessionFailure(error: unknown): boolean {
  return error instanceof RpcClientError || Schema.isSchemaError(error)
}

function waitForReady(
  ready: Deferred.Deferred<void>,
  disconnected: Deferred.Deferred<DaemonRpcConnectionError>,
  timeoutMs: number,
): Promise<void> {
  return runOrThrow(
    Deferred.await(ready).pipe(
      Effect.raceFirst(Effect.flatMap(Deferred.await(disconnected), Effect.fail)),
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () => Effect.fail(new DaemonRpcConnectionError(`daemon RPC connection timed out after ${timeoutMs}ms`)),
      }),
    ),
  )
}

export function createDaemonRpcClient(baseUrl: string, options: DaemonRpcClientOptions = {}): DaemonRpcClient {
  const url = toWsUrl(baseUrl)
  const requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? 30_000)
  const reconnectBaseDelayMs = Math.max(1, options.reconnectBaseDelayMs ?? 250)
  const subscriptions = new Set<Subscription<unknown>>()
  let session: Session | null = null
  let sessionPromise: Promise<Session> | null = null
  let pendingRuntime: TokmonRuntime | null = null
  let supervisorPromise: Promise<void> | null = null
  let reconnectFiber: Fiber.Fiber<unknown, unknown> | null = null
  let reconnectAttemptsUsed = 0
  let hasConnected = false
  let closed = false

  const reportSubscriberError = (error: unknown) => {
    if (options.onSubscriberError) {
      try { options.onSubscriberError(error) } catch (reportError) {
        console.error('[tokmon] daemon RPC subscriber error reporter failed', reportError)
      }
      return
    }
    console.error('[tokmon] daemon RPC subscriber failed', error)
  }

  const setConn = (state: RpcConnState, error?: unknown) => {
    try { options.onConn?.(state, error) } catch (callbackError) {
      reportSubscriberError(callbackError)
    }
  }

  const cancelReconnect = (): Promise<void> => {
    const fiber = reconnectFiber
    reconnectFiber = null
    return interruptFiber(fiber)
  }

  const stopSubscriptionFiber = (subscription: Subscription<unknown>): Promise<void> => {
    const fiber = subscription.fiber
    subscription.fiber = null
    subscription.owner = null
    return interruptFiber(fiber)
  }

  const disposeSubscription = (subscription: Subscription<unknown>): Promise<void> => {
    subscription.active = false
    subscriptions.delete(subscription)
    const watchdog = subscription.watchdogFiber
    subscription.watchdogFiber = null
    return Promise.all([interruptFiber(watchdog), stopSubscriptionFiber(subscription)]).then(() => undefined)
  }

  const scheduleReconnect = () => {
    if (closed || subscriptions.size === 0 || reconnectFiber || session || sessionPromise) return
    if (typeof options.reconnectAttempts === 'number' && reconnectAttemptsUsed >= options.reconnectAttempts) return
    const delayMs = Math.min(2_500, reconnectBaseDelayMs * 1.5 ** reconnectAttemptsUsed)
    reconnectFiber = Effect.runFork(
      Effect.sleep(Duration.millis(delayMs)).pipe(
        Effect.andThen(Effect.sync(() => {
          reconnectFiber = null
          reconnectAttemptsUsed++
          connectSubscriptions()
        })),
      ),
    )
  }

  const invalidateSession = (
    active: Session,
    state: Extract<RpcConnState, 'reconnecting' | 'error'>,
    error?: unknown,
  ) => {
    if (active.invalidated) return
    active.invalidated = true
    if (session === active) session = null
    // Settle the deferred so the disconnect-observer fiber always terminates,
    // even when the session dies from a request failure rather than the socket.
    Deferred.doneUnsafe(active.disconnected, Effect.succeed(new DaemonRpcConnectionError()))
    void active.runtime.dispose().catch(() => {})
    if (!closed) setConn(state, error)
    scheduleReconnect()
  }

  const makeProtocolLayer = async (
    ready: Deferred.Deferred<void>,
    disconnected: Deferred.Deferred<DaemonRpcConnectionError>,
  ) => {
    const socketLayer = await socketLayerFor(url, options.transport, requestTimeoutMs)
    const connectionHooksLayer = Layer.succeed(
      RpcClient.ConnectionHooks,
      RpcClient.ConnectionHooks.of({
        onConnect: Effect.asVoid(Deferred.succeed(ready, undefined)),
        onDisconnect: Effect.asVoid(
          Effect.suspend(() => Deferred.succeed(disconnected, new DaemonRpcConnectionError())),
        ),
      }),
    )
    return Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        retryPolicy: Schedule.recurs(0),
        retryTransientErrors: false,
      }),
    ).pipe(
      Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson, connectionHooksLayer)),
    )
  }

  const ensureSession = async (): Promise<Session> => {
    if (closed) throw new Error('daemon RPC client is closed')
    if (session) return session
    if (sessionPromise) return sessionPromise

    setConn(hasConnected ? 'reconnecting' : 'connecting')
    const pending = (async () => {
      let runtime: TokmonRuntime | null = null
      try {
        const ready = Deferred.makeUnsafe<void>()
        const disconnected = Deferred.makeUnsafe<DaemonRpcConnectionError>()
        const protocolLayer = await makeProtocolLayer(ready, disconnected)
        const clientLayer = Layer.effect(
          TokmonRpcClient,
          RpcClient.make(TokmonRpcGroup),
        ).pipe(Layer.provide(protocolLayer))
        runtime = ManagedRuntime.make(clientLayer)
        pendingRuntime = runtime
        await runtime.runPromise(TokmonRpcClient.asEffect())
        await waitForReady(ready, disconnected, requestTimeoutMs)
        if (closed) throw new Error('daemon RPC client is closed')

        const active: Session = {
          runtime,
          disconnected,
          invalidated: false,
        }
        session = active
        pendingRuntime = null
        hasConnected = true
        reconnectAttemptsUsed = 0
        setConn('live')
        Effect.runFork(
          Effect.map(Deferred.await(active.disconnected), (error) => {
            invalidateSession(active, 'reconnecting', error)
          }),
        )
        startAllSubscriptions(active)
        return active
      } catch (error) {
        if (pendingRuntime === runtime) pendingRuntime = null
        await runtime?.dispose().catch(() => {})
        if (!closed) setConn('error', error)
        throw error
      }
    })()
    sessionPromise = pending
    try {
      return await pending
    } finally {
      if (sessionPromise === pending) sessionPromise = null
    }
  }

  const run = async <A>(
    method: string,
    effectFor: (client: TokmonClient) => Effect.Effect<A, unknown>,
  ): Promise<A> => {
    const active = await ensureSession()
    try {
      return await active.runtime.runPromise(
        TokmonRpcClient.use((client) => effectFor(client)).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(requestTimeoutMs),
            orElse: () => Effect.fail(new DaemonRpcRequestTimeoutError(method, requestTimeoutMs)),
          }),
        ),
      )
    } catch (rawError) {
      const error = normalizeRequestFailure(rawError)
      if (!closed && isSessionFailure(error)) invalidateSession(active, 'error', error)
      throw error
    }
  }

  const startSubscription = <A>(subscription: Subscription<A>, active: Session) => {
    if (closed || !subscription.active || subscription.fiber || active.invalidated) return
    subscription.lastValueAt = Date.now()
    subscription.staleAfterMs = options.snapshotStaleFloorMs ?? 90_000
    subscription.owner = active
    const fiber = active.runtime.runFork(
      TokmonRpcClient.use((client) =>
        subscription.streamFor(client).pipe(
          Stream.runForEach((value) =>
            Effect.sync(() => {
              subscription.lastValueAt = Date.now()
              if (subscription.staleAfterFor) subscription.staleAfterMs = subscription.staleAfterFor(value)
              try { subscription.onValue(value) } catch (error) { reportSubscriberError(error) }
            }),
          ),
        ),
      ),
    )
    subscription.fiber = fiber
    fiber.addObserver((exit) => {
      if (subscription.fiber === fiber) subscription.fiber = null
      if (subscription.owner === active) subscription.owner = null
      if (closed || !subscription.active || active.invalidated) return
      if (Exit.isSuccess(exit)) {
        invalidateSession(active, 'reconnecting')
      } else {
        invalidateSession(active, 'error', Cause.squash(exit.cause))
      }
    })
  }

  const startAllSubscriptions = (active: Session) => {
    for (const subscription of subscriptions) startSubscription(subscription, active)
  }

  function connectSubscriptions(): void {
    if (closed || subscriptions.size === 0 || supervisorPromise) return
    supervisorPromise = ensureSession()
      .then(() => undefined)
      .catch(() => { scheduleReconnect() })
      .finally(() => { supervisorPromise = null })
  }

  const subscribe = <A>(
    streamFor: (client: TokmonClient) => Stream.Stream<A, unknown>,
    onValue: (value: A) => void,
    staleAfterFor?: (value: A) => number,
  ): (() => void) => {
    if (closed) return () => {}
    const subscription: Subscription<A> = {
      streamFor,
      onValue,
      staleAfterFor,
      active: true,
      fiber: null,
      owner: null,
      watchdogFiber: null,
      lastValueAt: 0,
      staleAfterMs: Number.POSITIVE_INFINITY,
    }
    subscriptions.add(subscription as Subscription<unknown>)

    if (staleAfterFor) {
      const checkEveryMs = Math.min(5_000, Math.max(10, (options.snapshotStaleFloorMs ?? 90_000) / 2))
      const checkStaleness = Effect.sync(() => {
        if (!subscription.fiber || !subscription.owner || subscription.lastValueAt === 0) return
        if (Date.now() - subscription.lastValueAt <= subscription.staleAfterMs) return
        subscription.lastValueAt = Date.now()
        invalidateSession(subscription.owner, 'reconnecting')
      })
      subscription.watchdogFiber = Effect.runFork(
        checkStaleness.pipe(Effect.repeat(Schedule.spaced(Duration.millis(checkEveryMs)))),
      )
    }

    if (session) startSubscription(subscription, session)
    else connectSubscriptions()

    return () => {
      void disposeSubscription(subscription as Subscription<unknown>)
      if (subscriptions.size === 0) void cancelReconnect()
    }
  }

  return {
    getConfig: () =>
      run(TOKMON_WS_METHODS.getConfig, client => client[TOKMON_WS_METHODS.getConfig]({
        capabilities: [TYPED_READ_FAILURES_CAPABILITY],
      }))
        .then(normalizeConfigState),

    setConfig: (update) =>
      run(TOKMON_WS_METHODS.setConfig, client => client[TOKMON_WS_METHODS.setConfig](update))
        .then(normalizeConfigState),

    refresh: (scope = 'all') =>
      run(TOKMON_WS_METHODS.refresh, client => client[TOKMON_WS_METHODS.refresh]({ scope })),

    browseFs: (path) =>
      run(TOKMON_WS_METHODS.browseFs, client => client[TOKMON_WS_METHODS.browseFs]({
        path,
        capabilities: [TYPED_READ_FAILURES_CAPABILITY],
      })),

    subscribeSnapshot: (onSnapshot) =>
      subscribe(
        client => client[TOKMON_WS_METHODS.snapshot]({}).pipe(Stream.map(materializeWebSnapshot)),
        onSnapshot,
        snapshot => Math.max(options.snapshotStaleFloorMs ?? 90_000, snapshot.intervalMs * 3),
      ),

    subscribeConfig: (onConfig) =>
      subscribe(
        client => client[TOKMON_WS_METHODS.config]({}).pipe(Stream.map(normalizeConfigState)),
        onConfig,
      ),

    async close() {
      if (closed) return
      closed = true
      setConn('closed')
      const cleanup = [...subscriptions].map(disposeSubscription)
      subscriptions.clear()
      const activeSession = session
      session = null
      await cancelReconnect()
      await pendingRuntime?.dispose().catch(() => {})
      await Promise.all(cleanup)
      await activeSession?.runtime.dispose().catch(() => {})
      if (activeSession) {
        Deferred.doneUnsafe(activeSession.disconnected, Effect.succeed(new DaemonRpcConnectionError()))
      }
      await sessionPromise?.catch(() => {})
      pendingRuntime = null
      sessionPromise = null
      supervisorPromise = null
    },
  }
}
