# Web dashboard

```bash
tokmon serve
tokmon serve --port 8080
tokmon serve --no-open
```

The dashboard binds to `127.0.0.1` and opens `http://127.0.0.1:4317` by
default. It renders the cached snapshot first, then receives live updates over
a same-origin WebSocket.

## Pages

- Overview: KPIs, provider limits, and merged or split cost history.
- Analytics: daily spend calendar, provider/model splits, token composition,
  cache savings, and cumulative spend.
- Models: sortable model leaderboard with trends and per-call figures.
- Explore: searchable daily, weekly, and monthly rows with model breakdowns.

Global filters cover provider, account, model, and `7d`, `30d`, `90d`, `MTD`,
`6M`, or all-time ranges. Panels can be exported as PNG files with the selected
theme applied.

## Network access

Loopback mode needs no login token because only local processes can connect.
LAN mode is optional and marked unsafe in settings. If a reverse proxy or
ingress uses a DNS name, add the exact host to Allowed hosts. IP hosts are
accepted in LAN mode.

Network setting changes take effect after the daemon restarts.

## Bundling

The web dashboard is built into `dist/web` and shipped inside the npm package
and Electron resources. Users do not need a separate frontend build or an
internet connection to open it.
