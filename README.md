# tokmon

Terminal dashboard for Claude Code usage, costs, and rate limits.

Built with [Ink](https://github.com/vadimdemedes/ink), TypeScript.

![tokmon dashboard](screenshot.png)

## Quick Start

```bash
npx tokmon
```

Or with pnpm:

```bash
pnpm dlx tokmon
```

### Global Install

```bash
npm install -g tokmon
```

Then just run `tokmon`. Press `q` to quit.

## Options

```
-i, --interval <seconds>  Refresh interval in seconds (default: 2)
-h, --help                Show help
```

## Keybindings

| Key | Action |
|-----|--------|
| `Tab` / `←→` | Switch between Dashboard and Table |
| `1` `2` | Jump to view |
| `d` `w` `m` | Daily / Weekly / Monthly (in Table view) |
| `↑` `↓` | Scroll table |
| `PgUp` `PgDn` | Scroll table fast |
| `s` | Settings |
| `q` | Quit |

## Views

| View | Description |
|------|-------------|
| **Dashboard** | Today / week / month cost summaries, burn rate ($/hr), real-time rate limits with reset countdowns |
| **Table → Daily** | Per-day breakdown with models, tokens, and costs (6 months of history) |
| **Table → Weekly** | Grouped by ISO week |
| **Table → Monthly** | Grouped by month |

## Rate Limits

Fetches real billing data from Anthropic's OAuth API (reads your token from macOS Keychain automatically). Shows:

- **Session** — 5-hour utilization with reset countdown
- **Weekly** — 7-day utilization with reset countdown
- **Sonnet** — Sonnet-specific limits (if applicable)
- **Extra usage** — spend vs monthly limit

Polls every 2 minutes to stay within API rate limits.

## Settings

Press `s` to open settings. Persisted to `~/.config/tokmon/config.json` (macOS/Linux) or `%APPDATA%\tokmon\config.json` (Windows).

- **Refresh interval** — adjust with `←→`
- **Clear screen** — on/off toggle

## How It Works

Reads Claude Code's JSONL session logs directly from `~/.claude/projects/`. Calculates costs using Claude model pricing (Opus, Sonnet, Haiku). Caches file reads by mtime so refreshes are near-instant.

Dashboard loads current month only (fast). Table loads 6 months lazily on first switch.

Cross-platform: supports macOS, Linux, and Windows (`%APPDATA%`, `XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR`).

## CI/CD

Publishes to npm via GitHub Actions on version tags:

```bash
git tag v0.5.0 && git push --tags
```

## Requirements

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## Author

By [David Ilie](https://davidilie.com)

## License

[MIT](LICENSE)
