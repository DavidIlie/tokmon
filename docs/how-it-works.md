# How it works

## One daemon, several clients

The daemon owns provider discovery, parsing, billing refresh, configuration,
and RPC. The terminal UI, web dashboard, desktop app, and query commands consume
the same contract.

At startup, a client checks the platform cache record. If a compatible daemon
is alive, it attaches. Otherwise it becomes the owner and records its endpoint.
This avoids duplicate provider polling and mismatched totals.

## Contracts

Provider readers normalize data into shared account, quota, dashboard, table,
and billing types. Presentation adapters then shape the same snapshot for the
TUI, desktop renderer, web socket, and JSON commands.

Configuration updates include a revision and use compare-and-swap semantics.
Clients must retry against fresh state instead of overwriting concurrent edits.

## Collection and caching

Local usage readers aggregate per day, account, provider, and model. File-backed
sources use modification time and size fingerprints so unchanged sessions are
not parsed again. Edited and deleted sources invalidate their cached shards.

Usage and billing have separate refresh schedules. Opening another client reuses
fresh billing data; it does not force another provider API call.

## Web transport

The daemon serves the prebuilt dashboard and a same-origin WebSocket. A cached
snapshot makes first paint immediate; live messages update it afterwards. The
stream idles when no browser is connected.

## Development channels

Installed clients use the release daemon record. Every `pnpm dev*` command uses
a tagged `dev` channel and separate record. `pnpm run dev:installed` launches an
installed Electron bundle against that development channel for end-to-end tests.
