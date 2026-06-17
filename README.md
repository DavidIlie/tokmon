# tokmon

Terminal dashboard for **Claude Code**, **Codex**, **Cursor**, **Copilot**, **opencode**, **pi**, **Antigravity**, and **Gemini** — usage, costs, and rate limits, all in one place.

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

**Usage providers** — full cost & token history (Today / Week / Month, sparkline, per-model table):

| Provider | What it reads | What you get |
|----------|---------------|--------------|
| **Claude** | `~/.claude/projects/**/*.jsonl` | Cost & token history, plan (e.g. Max 20x), live 5h / weekly / Sonnet limits |
| **Codex** | `~/.codex/sessions/**/rollout-*.jsonl` | Cost & token history, plan, live 5h / weekly limits, credit balance |
| **opencode** | `~/.local/share/opencode/opencode.db` | Cost & token history across whatever providers opencode routes to (uses its own recorded cost) |
| **pi** | `~/.pi/agent/sessions/**/*.jsonl` | Cost & token history (uses pi's own recorded cost) |

**Billing / quota providers** — plan + live quota or spend (no local token history):

| Provider | What it reads | What you get |
|----------|---------------|--------------|
| **Cursor** | `state.vscdb` + local tracking DBs | Plan, current-period spend, on-demand caps, per-model spend, AI-code activity |
| **Copilot** | GitHub token (gh / VS Code) | Plan + premium-request & chat quota |
| **Antigravity** | its `state.vscdb` OAuth → Google Cloud Code | Plan + per-pool (Gemini Pro/Flash/Claude) quota |
| **Gemini** | `~/.gemini/oauth_creds.json` → Google Cloud Code | Plan + quota (re-run `gemini` to refresh an expired token) |

tokmon auto-detects which tools are installed (on `PATH` or as a desktop app). On first launch you pick which to track, and when a new provider you have installed is added in an update, tokmon offers it once on the next launch. You can also toggle any provider in settings.

Costs use each model's published pricing (or the tool's own recorded cost where it stores one). **Cached tokens are billed at the discounted cache-read rate**, not full input rate — so tokmon's totals reflect what you're actually charged, and tend to be far lower than tools that count cache reads at full price.

## Views

### Dashboard

A responsive grid of provider cards (or one card at a time — see **Dashboard layout** in settings). Each card shows:

- **Today / This Week / This Month** — cost and token summaries
- **Burn rate** — current $/hr
- **Cache saved** — what caching has saved you
- **Rate limits** — live utilization bars with reset countdowns
- **Sparkline** — recent daily activity

The grid reflows to fit your terminal — more columns when it's wide, compacting cards when it's short. With more providers than fit on screen, it splits into **pages**; **scroll** (mouse wheel) to move between them (or `↑`/`↓` / `[` `]`). When you track more than one account, a focus strip lets you view **All** together or zoom into a single account.

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

## Web Dashboard

Prefer a browser? `tokmon serve` starts a local web dashboard with the same data as the TUI — charts, global filtering, and shareable images — in a terminal-styled UI. Press `w` (or `W`) inside the TUI to toggle it without leaving the terminal; the header shows `● web :4317` while it's running.

```bash
tokmon serve            # opens http://127.0.0.1:4317 in your browser
tokmon serve --port 8080
tokmon serve --no-open  # don't auto-open the browser
```

It binds to `127.0.0.1` only and reads the same data read-only — nothing leaves your machine. It renders instantly from a cached snapshot, then streams live updates over SSE, and goes idle when no tab is open. Filter by provider, model, account, and period (the URL updates, so a filtered view is shareable), flip between dark and light, and export any panel — or a summary card — as a PNG with the **Share** button.

### Overview

KPIs with inline sparklines, provider cards with live rate-limit bars, and a cost-over-time chart that spans your full history by default. Toggle **merged** (one combined total) vs **split** (a line per provider), **all-time** vs the selected period, and linear vs log.

![tokmon web dashboard — overview](docs/web/overview.png)

### Analytics

A full-width, all-time daily-spend calendar — hover any day for a per-model spend breakdown — with at-a-glance stats (busiest day, daily average, top weekday, current streak), alongside cost-by-model, an interactive provider split, token composition, cache savings, and cumulative spend.

![tokmon web dashboard — analytics](docs/web/analytics.png)

### Models

A leaderboard sortable by cost / tokens / calls, each row showing a per-model trend sparkline, cost-per-call, tokens, and calls — over tokens-by-model and cache-savings-by-model charts.

![tokmon web dashboard — models](docs/web/models.png)

### Explore

The full daily / weekly / monthly table — searchable, sortable on every column, with expandable per-model breakdowns.

![tokmon web dashboard — explore](docs/web/explore.png)

The dashboard is a prebuilt static bundle shipped in the package — no build step, fully offline.

## Keybindings

### Global

| Key | Action |
|-----|--------|
| `Tab` | Switch between Dashboard and Table |
| `←` `→` | (Dashboard) switch between Dashboard and Table |
| scroll / `↑` `↓` / `[` `]` | (Dashboard) move between pages when paginated |
| `a` `A` | Cycle account focus forward / back |
| `0`–`9` | Jump to an account focus slot |
| `w` `W` | Toggle the web dashboard (opens in your browser) |
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
- **ASCII glyphs** — `auto` (detect), `on` (force ASCII), or `off` (force Unicode)

**Providers** — toggle each provider on or off.

**Accounts** — add, edit, reorder, and delete accounts. Each account has a provider, a name, a home directory (so you can track multiple logins across different `HOME`s), and an accent color. Multiple accounts per provider are supported.

## Options

```
tokmon [options]            Launch the terminal dashboard
tokmon serve [options]      Launch the web dashboard (http://127.0.0.1:4317)

Options:
-i, --interval <seconds>  Refresh interval in seconds (default: from config, or 2)
    --ascii               Force ASCII glyphs (also: TOKMON_ASCII=1)
    --no-ascii            Force Unicode glyphs
-h, --help                Show help

serve options:
-p, --port <n>            Port to listen on (default: 4317, auto-falls back if taken)
    --no-open             Don't open the browser automatically
```

tokmon auto-detects whether your terminal can render Unicode (block sparklines, box borders) and falls back to ASCII on terminals/fonts that can't (e.g. legacy Windows console). Override with `--ascii` / `--no-ascii`, the `TOKMON_ASCII` env var, or the **ASCII glyphs** setting.

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

- It never writes to any provider's data — SQLite databases (Cursor, opencode) are opened strictly read-only.
- Credentials are read only to call each provider's **own official API** (Anthropic, ChatGPT backend, Cursor, GitHub, Google Cloud Code) for *your own* usage. Tokens are never logged, displayed, or sent anywhere else.
- The only outbound requests are to those provider APIs and the optional peak-pricing clock.

## How It Works

- Parses local CLI session logs and aggregates cost/token usage per day, week, and month.
- A persistent parse cache keyed by file **mtime + size** makes repeat launches near-instant; edited or deleted files are re-read automatically.
- Dashboard summaries and table history load independently, so the UI stays responsive on large histories.
- Rate limits and spend are fetched from each provider's API on the billing poll interval.

Cross-platform: macOS, Linux, Windows.

## Requirements

- Node.js 20+ (**24+ recommended**)
- The CLIs/apps you want to track
- **SQLite** for the Cursor / opencode readers: on Node 24+ this uses the built-in `node:sqlite` — **nothing to install**. On Node 20–23 it falls back to the system `sqlite3` CLI (preinstalled on macOS; `apt install sqlite3` / `winget install sqlite` elsewhere).

## CI/CD

Publishes to npm and GitHub Packages via GitHub Actions on version tags:

```bash
git tag v0.14.0 && git push --tags
```

## Author

By [David Ilie](https://davidilie.com)

## License

[MIT](LICENSE)
