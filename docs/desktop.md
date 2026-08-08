# Desktop app

Tokmon Desktop is a menu-bar app on macOS and a notification-area app on Windows
and Linux. It does not create a normal dock or taskbar window.

## Menu-bar summary

On macOS, pin up to two providers from their cards in the desktop overview. The
pin control shows each provider's fixed left-to-right position; Option-clicking
a third provider replaces position two. Activity is shown separately and never
replaces a pin or silently reorders providers.

The Menu Bar settings page is a live builder backed by the same renderer as the
real status item. Choose provider marks, usage or today's compact token total
(`843`, `1.2M`, `1B`), optional progress lines, and comfortable, compact, or
tight density. Auto mode progressively simplifies the strip on smaller displays
while keeping provider identity. Custom mode adds half-point controls for edge
padding, mark-to-value spacing, and the gap between providers. The preview's
width bracket shows the exact internal width; macOS owns the spacing outside it.

The same options are available from the CLI, for example:

```bash
tokmon config set menu-bar-mode custom
tokmon config set menu-bar-elements mark,value,progress
tokmon config set menu-bar-value tokens-today
tokmon config set menu-bar-density tight
```

Windows and Linux use a single status-aware tray icon and tooltip because their
tray APIs do not support the same adjacent menu-bar composition.

## Popover

Click the tray item to see every enabled provider and account. Disable an entire
provider from **Providers & Accounts** without deleting its discovered accounts;
re-enabling it restores its pin and expansion preferences. Provider cards
show:

- the same identity and usage score as the other clients;
- quota meters and reset times;
- token and cost totals;
- burn rate and cache savings;
- a configurable 7, 14, or 30-day graph.

A fixed summary above the footer combines every usage-capable provider: today's
money and token total stays visible while scrolling, with the month total beside
it and the week detail available to assistive technology and the native tooltip.

A provider with one default account does not repeat a synthetic “account 1”
label. Account identities appear only when they are needed to distinguish
multiple accounts.

For multiple detected accounts, expand the provider card and choose **Remove**
beside the unwanted account. This only removes it from Tokmon. Restore it later
under **Settings → Providers & Accounts**, where detected, manual, and removed
accounts have explicit lifecycle actions.

Closing the popover resets its navigation to the overview. Advanced analytics
and custom palette editing open in the web dashboard.

## Launch at login

Turn on **Launch at login** in **Settings → Desktop App** to start Tokmon
silently after sign-in. The preference is shared with the CLI, TUI, and web
settings, while the installed desktop app owns the native macOS or Windows
registration.

On macOS 13 or newer, Tokmon uses the main app login service and reports when
approval is still required in **System Settings → General → Login Items**.
Windows uses the installed executable and reports when Startup Apps has disabled
it. Development builds never register themselves, and Linux startup remains
managed by the desktop environment.

## Daemon ownership

The desktop app can own the daemon. A later `tokmon`, `tokmon serve`, or query
command checks the daemon record and attaches to that process. If the CLI starts
first, the desktop app attaches instead.

Attachment follows the daemon protocol rather than the app version. If an old
desktop build is still running an incompatible protocol, the CLI reports both
protocol versions immediately and asks you to update/restart the desktop app or
quit it; it never terminates a desktop-owned daemon behind your back.

An authenticated older CLI daemon can be retired during an upgrade. A newer
CLI daemon is never terminated by an older desktop or CLI, which prevents two
installed versions from repeatedly replacing each other's background service.

If pnpm's `minimumReleaseAge` policy intentionally holds back a just-published
Tokmon CLI, bare `pnpm dlx tokmon` may reuse an older cached version. Keep the
global policy and bypass it for this one trusted package invocation:

```bash
pnpm --config.minimum-release-age=0 dlx tokmon@latest
```

Development builds use a separate `dev` daemon channel, so an installed release
and `pnpm dev*` never share a socket or cache record.

## Updates

Release builds check GitHub Releases after launch and every hour. An update is
downloaded and natively staged by the operating system in the background; the popover shows preparing
and download progress while that happens. Once it is genuinely ready, a trailing
`↑` appears in the menu bar and the popover offers **Restart to Install**. The
button switches immediately to **Restarting…**, closes the daemon connection with
a bounded wait, and then hands off once to the native installer. Duplicate clicks
are ignored and a failed handoff returns to an actionable error instead of leaving
a silent process. A ready update also installs on the next clean quit. Development
builds never contact the update feed.

Use **Check for Updates** in Desktop App settings or the tray context menu to
request an immediate check. Linux AppImage builds use the same updater; deb
packages defer updates to the system package manager.

macOS versions 0.28.8 through 0.29.9 can download an update but wait forever for
a native staging signal that only starts after restart. If one of those versions
reports that the update made no progress, install the current signed build once
from [GitHub Releases](https://github.com/DavidIlie/tokmon/releases/latest).
Automatic updates resume after that manual bridge. Current builds also keep a
**Download Latest** escape hatch beside updater errors.
