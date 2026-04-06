# tokmon

Terminal dashboard for Claude Code usage and costs. Tabbed interface with auto-refresh.

Built with [Ink](https://github.com/vadimdemedes/ink), TypeScript.

```
  ◉ tokmon  ·  2s                                              01:17:09 AM

   Dashboard   Daily    ←→ or 1-2

  ┃ Claude
  ┃
  ┃ Today              $166.10     252.7M tokens
  ┃ This Week          $399.79     608.2M tokens
  ┃ This Month        $1337.03       2.2B tokens

  ┃ Active Block  12m remaining
  ┃
  ┃ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━─ 96%
  ┃
  ┃ $314.37 spent  ·  ~$328.01 proj  ·  $65.60/hr

  ──────────────────────────────────────────────────
  Total $1337.03

  by David Ilie (davidilie.com)
```

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

Then just run `tokmon`. Press `Ctrl+C` to exit.

## Options

```
-i, --interval <seconds>  Refresh interval in seconds (default: 2)
-h, --help                Show help
```

```bash
tokmon -i 5    # refresh every 5 seconds
```

## Views

Navigate between views with `←` `→` arrow keys, `Tab`, or number keys `1` `2`.

| View | Description |
|------|-------------|
| **Dashboard** | Today / week / month cost summaries, active 5-hour block with burn rate |
| **Daily** | Per-day breakdown table with model, token, and cost columns (scrollable with `↑` `↓`) |

## How It Works

Reads Claude Code's JSONL session logs directly from `~/.claude/projects/`. Calculates costs using Claude model pricing (Opus, Sonnet, Haiku). Caches file reads by mtime so subsequent refreshes are near-instant.

Cross-platform: supports macOS, Linux, and Windows (`%APPDATA%`, `XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR`).

## CI/CD

Publishes to npm automatically via GitHub Actions when a version tag is pushed:

```bash
git tag v0.2.0 && git push --tags
```

## Requirements

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (generates usage data in `~/.claude/projects/`)

## Tech Stack

| Tool | Purpose |
|------|---------|
| Ink 5 | React terminal UI |
| TypeScript 5.7+ | Strict mode |
| tsup | Build |

## Author

By [David Ilie](https://davidilie.com)

## License

[MIT](LICENSE)
