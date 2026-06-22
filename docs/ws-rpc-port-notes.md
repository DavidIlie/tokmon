# tokmon WS-RPC port notes

Task 1 status: study complete; isolated Effect-RPC spike implemented under `src/rpc/spike/*`; root and web typechecks pass; `pnpm run build` passes. No existing tokmon daemon/server/client transport files were changed.

## t3code contract pattern

t3code keeps the RPC contract in `packages/contracts`. The websocket contract lives in `packages/contracts/src/rpc.ts` and imports `Schema` from `effect`, plus `Rpc` and `RpcGroup` from `effect/unstable/rpc` subpaths (`/Users/david/dev/t3code/packages/contracts/src/rpc.ts:1`, `/Users/david/dev/t3code/packages/contracts/src/rpc.ts:2`, `/Users/david/dev/t3code/packages/contracts/src/rpc.ts:3`).

The method names are centralized in const maps. `WS_METHODS` contains server, filesystem, VCS, terminal, and subscription names (`/Users/david/dev/t3code/packages/contracts/src/rpc.ts:92`). Orchestration has its own `ORCHESTRATION_WS_METHODS` map in `orchestration.ts`, including `dispatchCommand`, `getTurnDiff`, `subscribeShell`, and `subscribeThread` (`/Users/david/dev/t3code/packages/contracts/src/orchestration.ts:20`).

Each operation is an exported `Rpc.make(name, { payload, success, error, stream })` value. Unary examples:

- `server.getConfig`: empty struct payload, `ServerConfig` success, typed error union (`/Users/david/dev/t3code/packages/contracts/src/rpc.ts:156`).
- `filesystem.browse`: `FilesystemBrowseInput` payload, `FilesystemBrowseResult` success, `FilesystemBrowseError` error (`/Users/david/dev/t3code/packages/contracts/src/rpc.ts:233`).

Streaming examples set `stream: true` and use the same `success` schema as the per-item stream payload:

- `subscribeVcsStatus` (`/Users/david/dev/t3code/packages/contracts/src/rpc.ts:239`).
- `orchestration.subscribeShell` (`/Users/david/dev/t3code/packages/contracts/src/rpc.ts:373`).
- `orchestration.subscribeThread` (`/Users/david/dev/t3code/packages/contracts/src/rpc.ts:380`).
- `subscribeServerConfig` (`/Users/david/dev/t3code/packages/contracts/src/rpc.ts:396`).

The exported `WsRpcGroup` is a flat `RpcGroup.make(...)` over all `Rpc.make` values (`/Users/david/dev/t3code/packages/contracts/src/rpc.ts:415`). Server implementation uses `WsRpcGroup.of({ [METHOD_NAME]: handler })`, so handler keys mirror the string maps rather than a nested service object (`/Users/david/dev/t3code/apps/server/src/ws.ts:564`).

Dependency shape: t3code pins `effect`, `@effect/platform-node`, and related Effect packages to `4.0.0-beta.59` in the workspace catalog (`/Users/david/dev/t3code/package.json:10`). The contracts package directly depends only on `effect` (`/Users/david/dev/t3code/packages/contracts/package.json:30`). The web app also directly depends on `effect` (`/Users/david/dev/t3code/apps/web/package.json:35`). The server directly depends on `effect` and the platform packages (`/Users/david/dev/t3code/apps/server/package.json:26`). Note: t3code also patches `effect@4.0.0-beta.59` (`/Users/david/dev/t3code/package.json:91`), so later tasks should inspect that patch if an unpatched install behaves differently.

## t3code server mount and websocket upgrade

The WS server imports `HttpRouter` and `HttpServerRequest` from `effect/unstable/http`, and `RpcSerialization` and `RpcServer` from `effect/unstable/rpc` (`/Users/david/dev/t3code/apps/server/src/ws.ts:27`, `/Users/david/dev/t3code/apps/server/src/ws.ts:28`).

The server builds a handler layer with `WsRpcGroup.toLayer(...)` (`/Users/david/dev/t3code/apps/server/src/ws.ts:142`). The returned service object is keyed by `WS_METHODS` and `ORCHESTRATION_WS_METHODS` constants (`/Users/david/dev/t3code/apps/server/src/ws.ts:564`).

Unary handlers return `Effect` values. Example: `server.getConfig` returns `loadServerConfig` through t3code's instrumentation wrapper (`/Users/david/dev/t3code/apps/server/src/ws.ts:775`). Stream handlers return `Stream` values. `subscribeShell` first reads a snapshot, then concatenates `Stream.make({ kind: "snapshot", snapshot })` with a live domain-event stream (`/Users/david/dev/t3code/apps/server/src/ws.ts:682`, `/Users/david/dev/t3code/apps/server/src/ws.ts:699`, `/Users/david/dev/t3code/apps/server/src/ws.ts:706`). `subscribeThread` uses the same snapshot-then-live pattern (`/Users/david/dev/t3code/apps/server/src/ws.ts:716`, `/Users/david/dev/t3code/apps/server/src/ws.ts:762`). `subscribeServerConfig` streams an initial config snapshot and then live keybinding/provider/settings updates (`/Users/david/dev/t3code/apps/server/src/ws.ts:1033`, `/Users/david/dev/t3code/apps/server/src/ws.ts:1073`).

The websocket route is an Effect HTTP route, not a raw `node:http` upgrade handler:

- `HttpRouter.add("GET", "/ws", ...)` defines the route (`/Users/david/dev/t3code/apps/server/src/ws.ts:1135`).
- It reads the current `HttpServerRequest` service (`/Users/david/dev/t3code/apps/server/src/ws.ts:1141`).
- It authenticates the websocket upgrade before constructing the RPC effect (`/Users/david/dev/t3code/apps/server/src/ws.ts:1144`).
- It calls `RpcServer.toHttpEffectWebsocket(WsRpcGroup, { spanPrefix, spanAttributes })` (`/Users/david/dev/t3code/apps/server/src/ws.ts:1145`).
- It provides the concrete handler layer and `RpcSerialization.layerJson` (`/Users/david/dev/t3code/apps/server/src/ws.ts:1153`, `/Users/david/dev/t3code/apps/server/src/ws.ts:1154`).
- It marks the session connected/disconnected around the websocket lifetime (`/Users/david/dev/t3code/apps/server/src/ws.ts:1179`).

Serialization: the websocket RPC route uses `RpcSerialization.layerJson`, not NDJSON (`/Users/david/dev/t3code/apps/server/src/ws.ts:1154`). NDJSON exists elsewhere in t3code's ACP transport, but it is not the websocket RPC serialization used by `/ws`.

t3code's HTTP server is also Effect-owned. `server.ts` imports `HttpRouter` and `HttpServer` from `effect/unstable/http` (`/Users/david/dev/t3code/apps/server/src/server.ts:2`). On Node, it dynamically imports `@effect/platform-node/NodeHttpServer` and `node:http`, then creates a `NodeHttpServer.layer(NodeHttp.createServer, { host, port })` (`/Users/david/dev/t3code/apps/server/src/server.ts:114`, `/Users/david/dev/t3code/apps/server/src/server.ts:118`). Routes, including `websocketRpcRouteLayer`, are merged and served through `HttpRouter.serve(...)` (`/Users/david/dev/t3code/apps/server/src/server.ts:307`, `/Users/david/dev/t3code/apps/server/src/server.ts:397`).

Implication for tokmon: t3code does not show `RpcServer.toHttpEffectWebsocket` mounted onto an already-created raw `node:http.Server`. tokmon currently creates its own `node:http` server in `src/web/server.ts` (`/Users/david/dev/tokmon/src/web/server.ts:256`) and registers a request listener (`/Users/david/dev/tokmon/src/web/server.ts:264`). The feasibility spike must inspect the installed Effect platform types to decide whether to wrap an existing server or whether the later replacement should move tokmon's web server fully under Effect HTTP.

## t3code client connection, reconnect, auth, and remote URLs

The low-level browser RPC protocol imports `RpcClient` and `RpcSerialization` from `effect/unstable/rpc`, and `Socket` from `effect/unstable/socket/Socket` (`/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:3`, `/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:4`). It creates the typed Effect client with `RpcClient.make(WsRpcGroup)` (`/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:58`).

Connection URL resolution happens in two phases:

- Remote/primary environment code produces a base `wsBaseUrl`. The primary browser target derives `ws:` or `wss:` from `window.location.origin` (`/Users/david/dev/t3code/apps/web/src/environments/primary/target.ts:93`).
- The protocol layer validates that the URL is `ws:` or `wss:` and rewrites the pathname to `/ws` while preserving query params (`/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:71`, `/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:77`).

The actual browser socket is created through `Socket.layerWebSocket(resolvedUrl)` with a custom `Socket.WebSocketConstructor` that records open/error/close lifecycle events (`/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:174`, `/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:178`, `/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:213`). The client protocol uses `RpcClient.makeProtocolSocket({ retryPolicy, retryTransientErrors: true })`, and the retry policy is a bounded schedule with delay from t3code's reconnect state (`/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:216`, `/Users/david/dev/t3code/apps/web/src/rpc/protocol.ts:222`).

The web app wraps the low-level Effect client in a `WsTransport`. Each session owns a `ManagedRuntime` and closeable `Scope` (`/Users/david/dev/t3code/apps/web/src/rpc/wsTransport.ts:38`, `/Users/david/dev/t3code/apps/web/src/rpc/wsTransport.ts:242`). Unary calls use `transport.request`, which awaits the client and runs the Effect in the session runtime (`/Users/david/dev/t3code/apps/web/src/rpc/wsTransport.ts:79`). Stream calls use `Stream.runForEach` and callback listeners (`/Users/david/dev/t3code/apps/web/src/rpc/wsTransport.ts:92`). Persistent subscriptions retry after transport-level disconnects and can invoke `onResubscribe` (`/Users/david/dev/t3code/apps/web/src/rpc/wsTransport.ts:115`, `/Users/david/dev/t3code/apps/web/src/rpc/wsTransport.ts:131`, `/Users/david/dev/t3code/apps/web/src/rpc/wsTransport.ts:190`). Reconnect swaps the active session and closes the old scope (`/Users/david/dev/t3code/apps/web/src/rpc/wsTransport.ts:201`, `/Users/david/dev/t3code/apps/web/src/rpc/wsTransport.ts:214`).

The ergonomic `WsRpcClient` is a hand-written facade over the flat generated client. It maps domain groups to method constants, for example `server.getConfig` calls `client[WS_METHODS.serverGetConfig]({})` (`/Users/david/dev/t3code/apps/web/src/rpc/wsRpcClient.ts:55`, `/Users/david/dev/t3code/apps/web/src/rpc/wsRpcClient.ts:143`, `/Users/david/dev/t3code/apps/web/src/rpc/wsRpcClient.ts:234`). Stream facade methods call `transport.subscribe(...)` with the method constant as the tag (`/Users/david/dev/t3code/apps/web/src/rpc/wsRpcClient.ts:244`).

Remote auth uses a short-lived websocket token. The web app POSTs `/api/auth/ws-token` with the bearer token (`/Users/david/dev/t3code/apps/web/src/environments/remote/api.ts:125`, `/Users/david/dev/t3code/apps/web/src/environments/remote/api.ts:129`), then appends `wsToken=<token>` to `wsBaseUrl` (`/Users/david/dev/t3code/apps/web/src/environments/remote/api.ts:137`, `/Users/david/dev/t3code/apps/web/src/environments/remote/api.ts:146`). Desktop SSH uses the same query-param shape after asking the bridge to issue a token (`/Users/david/dev/t3code/apps/web/src/environments/runtime/service.ts:728`, `/Users/david/dev/t3code/apps/web/src/environments/runtime/service.ts:733`, `/Users/david/dev/t3code/apps/web/src/environments/runtime/service.ts:735`). Saved environments choose either desktop SSH token resolution or remote token resolution before constructing `WsTransport` (`/Users/david/dev/t3code/apps/web/src/environments/runtime/service.ts:1150`, `/Users/david/dev/t3code/apps/web/src/environments/runtime/service.ts:1158`, `/Users/david/dev/t3code/apps/web/src/environments/runtime/service.ts:1163`).

## tokmon target surface

Current tokmon server routes:

- `GET /api/data` returns the current snapshot.
- `GET /api/stream` is SSE for snapshot/config events.
- `GET/PUT /api/config`, `POST /api/refresh`, and `GET /api/fs` are privileged routes protected by loopback host/origin and `X-Tokmon-Client: 1` (`/Users/david/dev/tokmon/src/web/server.ts:65`, `/Users/david/dev/tokmon/src/web/server.ts:182`, `/Users/david/dev/tokmon/src/web/server.ts:211`, `/Users/david/dev/tokmon/src/web/server.ts:222`).
- Static SPA or Vite middleware is served from the same raw `node:http` server (`/Users/david/dev/tokmon/src/web/server.ts:232`, `/Users/david/dev/tokmon/src/web/server.ts:242`).

Current data engine surface maps directly to the intended RPC contract:

- `snapshot(): WebSnapshot | null`, `addSseClient`, `refresh(scope)`, `setConfig(...)`, and `broadcastConfig(config)` are defined in the engine interface (`/Users/david/dev/tokmon/src/web/data-engine.ts:40`).
- `RefreshScope` already matches the requested union: `all | summary | table | billing | peak` (`/Users/david/dev/tokmon/src/web/data-engine.ts:30`).
- `WebSnapshot` is browser-safe in `src/web/contract.ts` (`/Users/david/dev/tokmon/src/web/contract.ts:68`).
- `Config` is browser-safe in `src/config-schema.ts` and intentionally has no Node imports (`/Users/david/dev/tokmon/src/config-schema.ts:1`, `/Users/david/dev/tokmon/src/config-schema.ts:16`).

## tokmon dependency result

Installed dependencies:

- Root: `effect@4.0.0-beta.59` and `@effect/platform-node@4.0.0-beta.59`.
- Web app: `effect@4.0.0-beta.59`.

Rationale:

- `effect@4.0.0-beta.59` provides `effect/unstable/rpc`, `effect/unstable/http`, and `effect/unstable/socket` subpath exports used by t3code.
- `@effect/platform-node@4.0.0-beta.59` provides `NodeHttpServer.makeUpgradeHandler` and `NodeSocket`/`NodeWS`, which are needed to bridge Effect HTTP websocket handling to a raw Node server and to run the Node spike client.
- `RpcSerialization.layerJson` is inside `effect`; no separate serialization package is needed for the websocket RPC path.
- `msgpackr-extract` native build approval is not required for this spike because the server and clients use `RpcSerialization.layerJson`.

## t3code Effect patch finding

t3code has one Effect patch: `/Users/david/dev/t3code/patches/effect@4.0.0-beta.59.patch`. It patches `dist/unstable/rpc/RpcClient.d.ts` and `dist/unstable/rpc/RpcClient.js`, adding `RpcClient.RequestHooks`, expanding `RpcClient.ConnectionHooks`, and wiring heartbeat callbacks around `makeProtocolSocket`.

The patch does not modify `RpcServer`, `effect/unstable/http`, or server-side `effect/unstable/socket` upgrade code. tokmon does not need the patch for the minimal server/client spike. A later t3code-like browser transport may want equivalent request lifecycle and ping/pong timeout hooks for telemetry/reconnect UX, but they are not needed to prove the raw Node server mount.

## tokmon feasibility spike

Implemented files:

- `src/rpc/spike/contract.ts`: `Rpc.make` definitions for unary `spike.ping` and streaming `spike.ticks`, grouped by `SpikeRpcGroup`.
- `src/rpc/spike/server.ts`: throwaway raw `node:http.Server` plus isolated websocket route `/__tokmon_rpc_spike/ws`.
- `src/rpc/spike/node-client.ts`: Effect RPC Node client using `RpcClient.make(SpikeRpcGroup)`, `RpcClient.makeProtocolSocket`, `NodeSocket.layerWebSocket`, and `RpcSerialization.layerJson`.
- `web/src/rpc-spike-client.ts`: browser-bundleable Effect RPC client using `Socket.layerWebSocket` with `Socket.layerWebSocketConstructorGlobal`.
- `web/src/main.tsx`: one isolated import of `./rpc-spike-client` so Vite bundles the browser client without changing existing data flow.

Mount result: approach A works at the API/type/build level. The spike adapts `RpcServer.toHttpEffectWebsocket(SpikeRpcGroup, ...)` to an existing raw `node:http.Server` by constructing an Effect upgrade handler with:

```ts
const wss = new NodeWS.WebSocketServer({ noServer: true })
const httpEffect = RpcServer.toHttpEffectWebsocket(SpikeRpcGroup, ...)
const upgradeHandler = NodeHttpServer.makeUpgradeHandler(Effect.succeed(wss), httpEffect, { scope })
server.on("upgrade", (req, socket, head) => {
  if (pathname === SPIKE_WS_PATH) upgradeHandler(req, socket, head)
})
```

This is cleaner for tokmon than `NodeHttpServer.layerServer(existingServer, ...)`: `layerServer` can attach both request and upgrade listeners, while tokmon only needs an upgrade listener in a later task so the existing static and `/api/*` request handling can remain untouched during migration.

Runtime note: the sandbox blocked the local TCP bind needed to execute the node round-trip (`listen EPERM: operation not permitted 127.0.0.1`). The runnable proof command is:

```sh
pnpm exec tsup src/rpc/spike/node-client.ts --format esm --target node20 --platform node --out-dir .tmp-rpc-spike --external effect --external @effect/platform-node --clean
node .tmp-rpc-spike/node-client.js
rm .tmp-rpc-spike/node-client.js
rmdir .tmp-rpc-spike
```

Expected output shape:

```json
{"url":"ws://127.0.0.1:<port>/__tokmon_rpc_spike/ws","ping":"hello tokmon","ticks":[1,2,3]}
```

## Real contract surface created

Browser-safe module: `src/rpc/contract.ts`.

Proposed method maps:

```ts
export const TOKMON_WS_METHODS = {
  getConfig: "tokmon.getConfig",
  setConfig: "tokmon.setConfig",
  refresh: "tokmon.refresh",
  browseFs: "tokmon.browseFs",
  snapshot: "tokmon.snapshot",
  config: "tokmon.config",
} as const
```

Created RPC surface:

- `getConfig({}) -> Config`
- `setConfig(Config) -> Config`
- `refresh({ scope: "all" | "summary" | "table" | "billing" | "peak" }) -> void`
- `browseFs({ path: string }) -> FsListing`
- `snapshot({}) -> Stream<WebSnapshot>`
- `config({}) -> Stream<Config>`

Fs schemas:

```ts
FsEntry = { name: string; path: string; dir: boolean }
FsListing = { path: string; parent: string | null; entries: FsEntry[] }
```

Schema note: `Config` and `FsListing` use real `Schema.Struct` definitions. `ConfigSchema` is cast back to tokmon's existing mutable `Config` interface because Effect's struct and array schemas infer readonly properties/arrays by default. `WebSnapshot` uses `Schema.declare<WebSnapshot>` for this scaffold because fully modeling `DashboardData`/`TableData` would duplicate a wide existing type graph in the spike.

## Lean typed-WS-RPC fallback if Effect-RPC remains impractical

If package install or raw `node:http` mounting remains impractical, keep the t3code-like API shape but implement a small JSON websocket protocol:

Client to server:

```ts
type ClientFrame =
  | { id: string; type: "call"; method: keyof typeof TOKMON_WS_METHODS; payload: unknown }
  | { id: string; type: "subscribe"; method: "snapshot" | "config"; payload: unknown }
  | { id: string; type: "unsubscribe" }
```

Server to client:

```ts
type ServerFrame =
  | { id: string; type: "result"; value: unknown }
  | { id: string; type: "error"; error: { code: string; message: string } }
  | { id: string; type: "next"; value: unknown }
  | { id: string; type: "complete" }
```

Design constraints:

- Keep the same method map and grouped facade style as t3code (`client.server.getConfig()`, `client.server.config(cb)`), even if implementation is not Effect.
- Use the existing browser-safe `Config` and `WebSnapshot` types directly.
- Validate with `normalizeConfig` for `setConfig`; validate `refresh.scope` with the existing `RefreshScope` union; validate `browseFs.path` as a string.
- Mount on raw `node:http.Server` via `server.on("upgrade")`, checking loopback host/origin and `X-Tokmon-Client` or a future `wsToken`.
- Make remote-ready auth match t3code shape: HTTP endpoint issues a short-lived `wsToken`; websocket URL carries `?wsToken=...`; local loopback can use header/token bypass only where browser limitations require it.
- Streams should send an initial snapshot/config value, then live events, and should cleanly unsubscribe on socket close or explicit `unsubscribe`.

This fallback preserves contract shape and migration ergonomics while avoiding full Effect runtime cost in the SPA.

## Build and bundle result

Baseline before adding Effect deps:

- `index-Djes9RNh.js`: 407.15 kB, gzip 126.22 kB.
- `chart-YPllAQva.js`: 386.36 kB, gzip 106.96 kB.
- `breakdown-Ciakxse3.js`: 32.03 kB, gzip 9.03 kB.
- `timeline-CNMskwu1.js`: 26.51 kB, gzip 7.42 kB.
- `index-3CfVdZTn.css`: 68.65 kB, gzip 28.31 kB.
- `dist/web`: 1272 KiB.

Current production output with Effect deps and browser spike imported:

- `index-bx4xXJWF.js`: 622.08 kB, gzip 197.68 kB.
- `chart-iftLCXbv.js`: 386.36 kB, gzip 106.96 kB.
- `breakdown-CJZLjN75.js`: 32.03 kB, gzip 9.03 kB.
- `timeline-B_90N2Qo.js`: 26.51 kB, gzip 7.42 kB.
- `index-3CfVdZTn.css`: 68.65 kB, gzip 28.31 kB.
- `dist/web`: 1480 KiB.

Delta from baseline:

- Main JS: +214.93 kB, gzip +71.46 kB.
- `dist/web`: +208 KiB.

Verification commands:

- `npx tsc --noEmit`: pass.
- `npx tsc --noEmit -p web/tsconfig.json`: pass.
- `pnpm run build`: pass.

## Feasibility verdict

Verdict: Effect-RPC 1:1 is feasible for tokmon's architecture, with approach A preferred.

Reasoning:

- The contract style ports directly: flat method maps, `Rpc.make`, streams via `stream: true`, and `RpcGroup.make`.
- `RpcServer.toHttpEffectWebsocket` can be adapted to a raw Node server through `NodeHttpServer.makeUpgradeHandler` plus a manually created `NodeWS.WebSocketServer({ noServer: true })`.
- This keeps tokmon's current raw request listener, static serving, and `/api/*` routes intact for the later migration task.
- Vite can bundle the browser RPC client with `effect@4.0.0-beta.59`; the measured cost is about +214.93 kB raw / +71.46 kB gzip in the main JS chunk for this imported spike.
- The only missing proof in this sandbox is actual local socket execution, blocked by `listen EPERM` before the WebSocket code could run.

Fallback recommendation remains lean typed-WS-RPC only if the runnable command above fails outside the sandbox or if the SPA bundle delta is judged unacceptable.
