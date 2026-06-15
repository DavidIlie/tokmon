# tokmon

Terminal dashboard for **Claude Code**, **Codex**, and **Cursor** — usage, costs, and rate limits, all in one place.

Built with [Ink](https://github.com/vadimdemedes/ink) and TypeScript.

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

Then run `tokmon`. On first launch you'll pick which providers to track; press `q` to quit any time.

## Providers

| Provider | What it reads | What you get |
|----------|---------------|--------------|
| **Claude** | `~/.claude/projects/**/*.jsonl` session logs | Cost & token history, live 5h / weekly / Sonnet rate limits |
| **Codex** | `~/.codex/sessions/**/rollout-*.jsonl` | Cost & token history, live 5h / weekly limits, credit balance |
| **Cursor** | `state.vscdb` + local tracking DBs (via `sqlite3`) | Plan, current-period spend, on-demand caps, per-model spend, AI-code activity |

tokmon auto-detects which tools are installed (on `PATH` or as a desktop app) and offers them during onboarding. You can always enable a provider manually in settings, even if it isn't detected.

Costs use each model's published pricing. **Cached tokens are billed at the discounted cache-read rate**, not full input rate — so tokmon's totals reflect what you're actually charged, and tend to be far lower than tools that count cache reads at full price.

## Views

### Dashboard

A responsive grid of provider cards (or one card at a time — see **Dashboard layout** in settings). Each card shows:

- **Today / This Week / This Month** — cost and token summaries
- **Burn rate** — current $/hr
- **Cache saved** — what caching has saved you
- **Rate limits** — live utilization bars with reset countdowns
- **Sparkline** — recent daily activity

When you track more than one account, a focus strip lets you view **All** together or zoom into a single account.

A **Peak / Off-Peak** badge appears in the header (Claude only), fetched from [promoclock.co](https://promoclock.co) — peak hours drain session limits faster.

### Table

Per-provider history with a provider selector (`p` / `P`), search (`/`), and sorting (`o`).

For **Claude / Codex** — Daily, Weekly, and Monthly breakdowns (6 months of history). Each row shows models used, input/output/cache tokens, and cost. Press `Enter` to expand a per-model breakdown:

```
▸ Apr  7  haiku-4-5, op~  7.6K 487.0K  10.1M    1.1B  $603.89
          ├─ opus-4-6          7.5K    485.0K    10.0M      1.1B  $601.50
          └─ haiku-4-5          100     2.0K     100K      5.0M    $2.39
```

For **Cursor** — a per-model spend table (cost, request count, share of total, all-time), sourced from Cursor's local conversation data.

## Keybindings

### Global

| Key | Action |
|-----|--------|
| `Tab` | Switch between Dashboard and Table |
| `←` `→` | (Dashboard) switch between Dashboard and Table |
| `a` `A` | Cycle account focus forward / back |
| `0`–`9` | Jump to an account focus slot |
| `s` | Open settings |
| `q` | Quit |

### Table

| Key | Action |
|-----|--------|
| `p` `P` | Cycle provider forward / back |
| `/` | Search (Esc clears) |
| `o` | Cycle sort |
| `d` `w` `m` | Daily / Weekly / Monthly *(Claude/Codex)* |
| `←` `→` | Cycle period *(Claude/Codex)* |
| `Enter` | Expand row — per-model breakdown *(Claude/Codex)* |
| `↑` `↓` | Move cursor |
| `g` `G` | Jump to top / bottom |
| `PgUp` `PgDn` | Page scroll |
| `Esc` | Clear search, then collapse row |

### Settings

| Key | Action |
|-----|--------|
| `↑` `↓` | Select row |
| `←` `→` | Adjust value / toggle |
| `Enter` | Edit / confirm |
| `Space` | Toggle provider · set account active |
| `Shift`+`↑` `↓` | Reorder accounts |
| `d` `x` | Delete account |
| `s` / `Esc` | Close |

## Settings

Press `s` to open.

**General**

- **Refresh interval** — dashboard poll rate (default: 2s)
- **Billing poll** — rate-limit / spend API poll rate (default: 5m, min 1m to avoid rate limiting)
- **Clear screen** — clears the terminal on launch (like `watch`)
- **Timezone** — IANA timezone, or `System`
- **Dashboard layout** — `grid` (all providers at once) or `single` (one at a time)
- **Default focus** — start on `all`, or remember your `last` focused account

**Providers** — toggle each provider on or off.

**Accounts** — add, edit, reorder, and delete accounts. Each account has a provider, a name, a home directory (so you can track multiple logins across different `HOME`s), and an accent color. Multiple accounts per provider are supported.

## Options

```
-i, --interval <seconds>  Refresh interval in seconds (default: from config, or 2)
-h, --help                Show help
```

## Files

| Path | Purpose |
|------|---------|
| `~/.config/tokmon/config.json` (macOS/Linux) | Settings |
| `%APPDATA%\tokmon\config.json` (Windows) | Settings |
| `~/Library/Caches/tokmon` (macOS) | Parse cache |
| `~/.cache/tokmon` (Linux, or `$XDG_CACHE_HOME`) | Parse cache |
| `%LOCALAPPDATA%\tokmon\cache` (Windows) | Parse cache |

Config writes are atomic (temp + rename) so a crash mid-save can't corrupt the file.

## Privacy

tokmon runs entirely on your machine and reads everything **read-only**:

- It never writes to any provider's data (Cursor's `state.vscdb` and tracking DBs are opened with `sqlite3 -readonly`).
- Credentials are read only to call each provider's **own official API** (Anthropic, ChatGPT backend, Cursor) for *your own* usage. Tokens are never logged, displayed, or sent anywhere else.
- The only outbound requests are to those provider APIs and the optional peak-pricing clock.

## How It Works

- Parses local CLI session logs and aggregates cost/token usage per day, week, and month.
- A persistent parse cache keyed by file **mtime + size** makes repeat launches near-instant; edited or deleted files are re-read automatically.
- Dashboard summaries and table history load independently, so the UI stays responsive on large histories.
- Rate limits and spend are fetched from each provider's API on the billing poll interval.

Cross-platform: macOS, Linux, Windows.

## Requirements

- Node.js 20+
- The CLIs/apps you want to track ([Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), [Cursor](https://cursor.com))
- `sqlite3` on your `PATH` — required for Cursor (preinstalled on macOS; `apt install sqlite3` / `winget install sqlite` elsewhere)

## CI/CD

Publishes to npm and GitHub Packages via GitHub Actions on version tags:

```bash
git tag v0.13.0 && git push --tags
```

## Author

By [David Ilie](https://davidilie.com)

## License

[MIT](LICENSE)
