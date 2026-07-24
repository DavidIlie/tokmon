import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { NodeWS } from '@effect/platform-node/NodeSocket'
import { Effect, Exit, Layer, Queue, Scope, Stream } from 'effect'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import type { Config } from '../config'
import { loadConfig } from '../config'
import {
  ConfigPersistenceFailure as ConfigPersistenceRpcFailure,
  ConfigUpdateConflictFailure,
  RefreshFailure,
  TOKMON_WS_METHODS,
  TOKMON_WS_PATH,
  TokmonRpcGroup,
} from '../rpc/contract'
import {
  applyConfigUpdate,
  ConfigConflictError,
  ConfigPersistenceError as ConfigPersistenceWriteError,
  rediscoverEngineAccounts,
  toConfigState,
} from './config-control'
import type { DataEngine } from './data-engine'
import { listHomeDirectory } from './fs'
import { isAllowedLocalRequest } from './request-guard'

interface MountWsRpcDeps {
  readonly engine: DataEngine
  readonly state: { config: Config }
}

function isWsPath(req: IncomingMessage): boolean {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').pathname === TOKMON_WS_PATH
  } catch {
    return false
  }
}

function rejectUpgrade(socket: Duplex, status = 403, message = 'Forbidden'): void {
  try {
    socket.write(
      `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    )
  } catch {}
  try { socket.destroy() } catch {}
}

function snapshotStream(engine: DataEngine) {
  return Stream.callback<ReturnType<DataEngine['snapshot']> extends infer S ? NonNullable<S> : never>((queue) =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const unsubscribe = engine.subscribe((snapshot) => {
        if (snapshot != null) Queue.offerUnsafe(queue, snapshot)
      })
      yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe))
    }), { bufferSize: 16, strategy: 'sliding' })
}

function configStream(engine: DataEngine) {
  return Stream.callback<Config>((queue) =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const unsubscribe = engine.subscribeConfig((config) => {
        Queue.offerUnsafe(queue, config)
      })
      yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe))
    }), { bufferSize: 16, strategy: 'sliding' })
}

type ConfigRpcFailure = ConfigUpdateConflictFailure | ConfigPersistenceRpcFailure

function configUpdateFailureEffect(error: unknown): Effect.Effect<never, ConfigRpcFailure> {
  if (error instanceof ConfigConflictError) {
    return Effect.fail(new ConfigUpdateConflictFailure({ kind: 'conflict', state: error.state }))
  }
  if (error instanceof ConfigPersistenceWriteError) {
    return Effect.fail(new ConfigPersistenceRpcFailure({ kind: 'persistence', message: error.message }))
  }
  return Effect.die(error)
}

function configUpdateEffect(
  engine: DataEngine,
  state: { config: Config },
  input: Parameters<typeof applyConfigUpdate>[2],
): Effect.Effect<Awaited<ReturnType<typeof applyConfigUpdate>>, ConfigRpcFailure> {
  return Effect.tryPromise({
    try: () => applyConfigUpdate(engine, state, input),
    catch: error => error,
  }).pipe(Effect.matchEffect({
    onFailure: configUpdateFailureEffect,
    onSuccess: Effect.succeed,
  }))
}

function refreshFailureEffect(error: unknown): Effect.Effect<never, RefreshFailure> {
  return error instanceof AggregateError
    ? Effect.fail(new RefreshFailure({ kind: 'refresh', message: error.message }))
    : Effect.die(error)
}

function refreshEffect(
  engine: DataEngine,
  state: { config: Config },
  scope: Parameters<DataEngine['refresh']>[0],
): Effect.Effect<void, RefreshFailure> {
  return Effect.tryPromise({
    try: async () => {
      if (scope === 'all') await rediscoverEngineAccounts(engine, state)
      await engine.refresh(scope)
    },
    catch: error => error,
  }).pipe(Effect.matchEffect({
    onFailure: refreshFailureEffect,
    onSuccess: Effect.succeed,
  }))
}

export async function mountWsRpc(server: Server, deps: MountWsRpcDeps): Promise<() => Promise<void>> {
  const scope = await Effect.runPromise(Scope.make())
  const wss = new NodeWS.WebSocketServer({ noServer: true })

  const handlersLayer = TokmonRpcGroup.toLayer(
    TokmonRpcGroup.of({
      [TOKMON_WS_METHODS.getConfig]: () =>
        Effect.promise(() => Promise.resolve(deps.state.config ?? loadConfig()).then(toConfigState)),
      [TOKMON_WS_METHODS.setConfig]: (config) =>
        configUpdateEffect(deps.engine, deps.state, config as never),
      [TOKMON_WS_METHODS.refresh]: ({ scope }) =>
        refreshEffect(deps.engine, deps.state, scope),
      [TOKMON_WS_METHODS.browseFs]: ({ path }) =>
        Effect.promise(() => listHomeDirectory(path)),
      [TOKMON_WS_METHODS.snapshot]: () => snapshotStream(deps.engine),
      [TOKMON_WS_METHODS.config]: () => configStream(deps.engine).pipe(Stream.map(toConfigState)),
    }),
  )

  const httpEffect = await Effect.runPromise(
    RpcServer.toHttpEffectWebsocket(TokmonRpcGroup, {
      spanPrefix: 'tokmon.rpc',
      spanAttributes: {
        'rpc.transport': 'websocket',
        'rpc.system': 'effect-rpc',
      },
    }).pipe(
      Effect.provide(handlersLayer.pipe(Layer.provideMerge(RpcSerialization.layerJson))),
      Scope.provide(scope),
    ),
  )

  const upgradeHandler = await Effect.runPromise(
    NodeHttpServer.makeUpgradeHandler(Effect.succeed(wss), httpEffect, { scope }).pipe(
      Scope.provide(scope),
    ),
  )

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isAllowedLocalRequest(req, deps.state.config.allowNetworkAccess, deps.state.config.allowedHosts)) {
      rejectUpgrade(socket)
      return
    }
    // Vite owns its HMR upgrade path in dev mode. Only intercept tokmon RPC;
    // rejecting every other upgrade here destroys valid HMR connections.
    if (!isWsPath(req)) return
    upgradeHandler(req, socket, head)
  }

  server.prependListener('upgrade', onUpgrade)

  return async () => {
    server.off('upgrade', onUpgrade)
    // ws.close waits for peers to close voluntarily; a browser with a suspended tab
    // must not keep the daemon alive forever.
    for (const client of wss.clients) {
      try { client.terminate() } catch {}
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 750)
      timer.unref?.()
      try { wss.close(() => { clearTimeout(timer); resolve() }) } catch { clearTimeout(timer); resolve() }
    })
    await Promise.race([
      Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => {}),
      new Promise<void>(resolve => { const timer = setTimeout(resolve, 750); timer.unref?.() }),
    ])
  }
}
