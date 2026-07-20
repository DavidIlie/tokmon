# Terminal UI

Run `tokmon` to open the dashboard. The layout responds to terminal width and
height, using a grid when several cards fit and pages when they do not.

## Views

The dashboard shows current cost, tokens, cache savings, burn rate, quota bars,
reset times, and recent activity. Account focus can show every account together
or one account at a time.

The table view has daily, weekly, and monthly rows with search, sorting, and an
expandable model breakdown.

## Global keys

| Key | Action |
| --- | --- |
| `Tab`, `←`, `→` | Switch dashboard/table |
| scroll, `↑`, `↓`, `[`, `]` | Move between dashboard pages |
| `a`, `A` | Cycle account focus forward/back |
| `0`–`9` | Jump to an account focus slot |
| `r`, `R` | Refresh usage, billing, peak status, and history |
| `p` | Toggle privacy mode (configurable) |
| `w`, `W` | Toggle the web dashboard |
| `s` | Open settings |
| `q` | Quit |

## Table keys

| Key | Action |
| --- | --- |
| `P` | Previous provider |
| `/` | Search; `Esc` clears |
| `o` | Cycle sort |
| `d`, `w`, `m` | Daily, weekly, monthly |
| `Enter` | Expand a model breakdown |
| `g`, `G` | Top or bottom |
| `PgUp`, `PgDn` | Page scroll |

## Settings keys

| Key | Action |
| --- | --- |
| `↑`, `↓` | Select a row |
| `←`, `→` | Adjust a value |
| `Enter` | Edit or confirm |
| `Space` | Toggle a provider or account |
| `Shift` + `↑`/`↓` | Reorder accounts |
| `d`, `x` | Delete a manual account |
| `s`, `Esc` | Close settings |

Tokmon detects Unicode support and falls back to ASCII where needed. Override
the result with `--ascii`, `--no-ascii`, `TOKMON_ASCII=1`, or the setting.
