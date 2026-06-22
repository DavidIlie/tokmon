import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { NodeWS } from '@effect/platform-node/NodeSocket'
import { Effect, Exit, Layer, Queue, Scope, Stream } from 'effect'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import type { Config } from '../config'
import { loadConfig } from '../config'
import { TOKMON_WS_METHODS, TOKMON_WS_PATH, TokmonRpcGroup } from '../rpc/contract'
import { applyConfigUpdate } from './config-control'
import type { DataEngine } from './data-engine'
import { listHomeDirectory } from './fs'

interface MountWsRpcDeps {
  readonly engine: DataEngine
  readonly state: { config: Config }
  readonly wsToken: string
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function hostOnly(value: string | undefined): string | null {
  if (!value) return null
  let host = value.trim().toLowerCase()
  if (!host) return null
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host.slice(1) : host.slice(1, end)
  }
  return host.split(':')[0] ?? null
}

function isLoopbackHost(value: string | undefined): boolean {
  const host = hostOnly(value)
  return host !== null && LOOPBACK_HOSTS.has(host)
}

function originHost(origin: string | undefined): string | null {
  if (!origin || origin === 'null') return null
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin || origin === 'null') return true
  return isLoopbackHost(originHost(origin) ?? undefined)
}

function isSameOrigin(req: IncomingMessage): boolean {
  const origin = originHost(header(req, 'origin'))
  if (!origin) return false
  return origin.toLowerCase() === (header(req, 'host') ?? '').toLowerCase()
}

function isWsPath(req: IncomingMessage): boolean {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').pathname === TOKMON_WS_PATH
  } catch {
    return false
  }
}

function wsToken(req: IncomingMessage): string | null {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('wsToken')
  } catch {
    return null
  }
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const host = header(req, 'host')
  const origin = header(req, 'origin')
  if (!isLoopbackHost(host) || !isLoopbackOrigin(origin)) return false

  if (header(req, 'x-tokmon-client') === '1') return true
  if (wsToken(req) === token) return true

  // Local browser clients cannot set X-Tokmon-Client on WebSocket upgrades.
  // Exact same-origin loopback pages are allowed for v1; remote clients should
  // use the wsToken query param.
  return isSameOrigin(req)
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

export async function mountWsRpc(server: Server, deps: MountWsRpcDeps): Promise<() => Promise<void>> {
  const scope = await Effect.runPromise(Scope.make())
  const wss = new NodeWS.WebSocketServer({ noServer: true })

  const handlersLayer = TokmonRpcGroup.toLayer(
    TokmonRpcGroup.of({
      [TOKMON_WS_METHODS.getConfig]: () =>
        Effect.promise(async () => deps.state.config ?? await loadConfig()),
      [TOKMON_WS_METHODS.setConfig]: (config) =>
        Effect.promise(() => applyConfigUpdate(deps.engine, deps.state, config)),
      [TOKMON_WS_METHODS.refresh]: ({ scope }) =>
        Effect.sync(() => { deps.engine.refresh(scope) }),
      [TOKMON_WS_METHODS.browseFs]: ({ path }) =>
        Effect.promise(() => listHomeDirectory(path)),
      [TOKMON_WS_METHODS.snapshot]: () => snapshotStream(deps.engine),
      [TOKMON_WS_METHODS.config]: () => configStream(deps.engine),
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
    if (!isWsPath(req)) return
    if (!isAuthorized(req, deps.wsToken)) {
      rejectUpgrade(socket)
      return
    }
    upgradeHandler(req, socket, head)
  }

  server.on('upgrade', onUpgrade)

  return async () => {
    server.off('upgrade', onUpgrade)
    await new Promise<void>((resolve) => { wss.close(() => resolve()) })
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
}
