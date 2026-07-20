# Development

## Repository layout

```text
src/                  CLI, daemon, providers, shared contracts, and TUI
src/desktop/          Electron main/preload/renderer and packaging config
web/                  local web dashboard
site/                 public Astro site
scripts/              development and release verification tools
test/                 integration and release-verifier tests
```

The root pnpm workspace contains the published package and Electron app. `web/`
and `site/` have isolated lockfiles and workspace boundaries. This keeps their
frontend dependencies out of npm packaging and desktop dependency resolution.

This is a deliberate hybrid workspace, not an `apps/*` monorepo. Moving paths
would touch package files, Electron resources, CI caches, Vercel, and release
verification. Do that only when a shared package boundary makes the migration
worthwhile.

## Install and check

```bash
pnpm install
pnpm --prefix web install
pnpm --prefix site install
pnpm run check
pnpm run check:desktop
pnpm run check:site
pnpm run build
pnpm run build:desktop
pnpm run build:site
```

## Development commands

```bash
pnpm run dev
pnpm run dev:web
pnpm run dev:desktop
pnpm run dev:site
```

All `pnpm dev*` commands use the `dev` daemon channel. The release channel and
its cache record remain untouched.

To run the installed app against the same development daemon:

```bash
pnpm run dev:installed
# another terminal
pnpm run dev
```

Set `TOKMON_DESKTOP_APP_PATH` if Tokmon is not installed in the platform's
default application directory.

## Change boundaries

- Provider readers should return shared provider types, not UI-specific data.
- New settings belong in the daemon schema and RPC contract before a client UI.
- The desktop renderer must not read provider files directly.
- Query JSON needs an explicit schema version and source identity.
- Release artifact names and metadata must stay compatible with the updater.

## Marketing site and Vercel

The Astro site is static and reads the root README at build time for `/docs`.
For Vercel, leave Root Directory at the repository root. The checked-in
`vercel.json` installs only `site/`, builds only `site/`, and publishes
`site/dist`. No environment variables are required.

Run a local Vercel-equivalent build without deploying:

```bash
pnpm --prefix site install --frozen-lockfile
pnpm --prefix site run build
```
