# Desktop app

Tokmon Desktop is a menu-bar app on macOS and a notification-area app on Windows
and Linux. It does not create a normal dock or taskbar window.

## Menu-bar summary

On macOS, pin up to two providers. Each item combines the provider mark with its
usage score. Activity is shown separately and never replaces a pin or silently
reorders providers.

Windows and Linux use a single status-aware tray icon and tooltip because their
tray APIs do not support the same adjacent menu-bar composition.

## Popover

Click the tray item to see every enabled provider and account. Provider cards
show:

- the same identity and usage score as the other clients;
- quota meters and reset times;
- token and cost totals;
- burn rate and cache savings;
- a configurable 7, 14, or 30-day graph.

Closing the popover resets its navigation to the overview. Advanced analytics
and custom palette editing open in the web dashboard.

## Daemon ownership

The desktop app can own the daemon. A later `tokmon`, `tokmon serve`, or query
command checks the daemon record and attaches to that process. If the CLI starts
first, the desktop app attaches instead.

Development builds use a separate `dev` daemon channel, so an installed release
and `pnpm dev*` never share a socket or cache record.

## Updates

Release builds check GitHub Releases after launch and every hour. An update is
downloaded in the background, then appears as a Restart action. It also installs
on the next clean quit. Development builds never contact the update feed.

Use Check for Updates from the tray context menu to request an immediate check.
