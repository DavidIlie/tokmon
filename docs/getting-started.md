# Getting started

## Requirements

- Node.js 20 or newer; Node.js 24 or newer is recommended.
- At least one supported coding tool installed or configured.
- SQLite only needs manual installation on Node.js 20–23 for Cursor and
  opencode. Node.js 24+ uses the built-in `node:sqlite` module.

On older Node releases, install the `sqlite3` CLI with your system package
manager. It is already present on macOS; Linux users can usually run
`apt install sqlite3`, and Windows users can run `winget install sqlite`.

## Run without installing

```bash
npx tokmon
# or
pnpm dlx tokmon
```

If you use pnpm's `minimumReleaseAge` setting immediately after a Tokmon
release, the bare command can intentionally reuse an older cached CLI. Run the
new release once without changing the global policy:

```bash
pnpm --config.minimum-release-age=0 dlx tokmon@latest
```

## Install the CLI

```bash
npm install -g tokmon
tokmon
```

The first run scans for supported tools and asks which providers to track. A
provider can be enabled without accepting every account Tokmon finds.

## Install the desktop app

Download the current installer from
[GitHub Releases](https://github.com/DavidIlie/tokmon/releases):

- macOS: DMG or ZIP for Apple silicon and Intel
- Windows: x64 NSIS installer
- Linux: x64 AppImage or Debian package

macOS releases are signed and notarized. Windows releases are currently
unsigned, so Windows may display a SmartScreen warning.

## Open the web dashboard

```bash
tokmon serve
```

The default URL is `http://127.0.0.1:4317`. Press `w` in the terminal UI to
open or close the same local dashboard.

## Next steps

- Learn the [terminal keybindings](tui.md).
- Check how each [provider is detected](providers.md).
- Use the [query commands](cli.md) from scripts or agents.
- Review the [privacy model](privacy-and-security.md).
