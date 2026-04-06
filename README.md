# tokmon

Terminal dashboard for Claude Code usage and costs. Refreshes every 2 seconds like `watch`.

Built with [Ink](https://github.com/vadimdemedes/ink), TypeScript.

```
  ◉ tokmon  ·  refreshing every 2s

  ┃ Claude
  ┃
  ┃ Today              $122.78     179.9M tokens
  ┃ This Week          $356.47     535.4M tokens
  ┃ This Month        $1293.71       2.1B tokens

  ┃ Active Block  35m remaining
  ┃
  ┃ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━──── 88%
  ┃
  ┃ $271.05 spent  ·  ~$306.63 proj  ·  $61.33/hr

  ──────────────────────────────────────────────────
  Total $1293.71                         12:54:49 AM
```

## Install

```bash
npm install -g tokmon
```

## Usage

```bash
tokmon
```

Press `Ctrl+C` to exit.

## What It Shows

- **Today / This Week / This Month** — cost and token totals from Claude Code JSONL logs
- **Active Block** — current 5-hour window with burn rate, projected cost, and time remaining
- Auto-refreshes every 2 seconds with mtime-based file caching

## How It Works

Reads Claude Code's JSONL session logs directly from `~/.claude/projects/`. Calculates costs using Claude model pricing (Opus, Sonnet, Haiku). Caches file reads by mtime so subsequent refreshes are near-instant.

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
