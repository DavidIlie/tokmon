# Privacy and security

Tokmon is a local collector. It does not run an ingest service and does not send
your history to a Tokmon account.

## Local reads

Provider logs and auth metadata are opened read-only. Cursor and opencode SQLite
databases are opened in read-only mode. Tokmon never edits a provider session,
database, token, or settings file.

The local parse cache contains derived usage rows and file fingerprints. Delete
the Tokmon cache directory to rebuild it from the provider sources.

## Credentials

Some live quota APIs require the credential already used by the provider's CLI
or desktop app. Tokmon reads that credential only to call the provider's own
service for your account. Credentials are not included in snapshots, logs,
exports, or UI state.

## Network calls

Depending on enabled providers, Tokmon may call Anthropic, ChatGPT, Cursor,
GitHub, or Google Cloud Code endpoints for live quota/billing. The optional
Claude peak-hours badge uses promoclock.co.

The web server and RPC socket bind to loopback by default. LAN mode expands that
boundary and should be enabled only on a network you trust. Allowed hosts
restrict DNS-based reverse proxies.

## Privacy mode

Privacy mode redacts account identities in terminal, web, desktop, and export
surfaces. The default shortcut is `p` and can be changed in settings. Privacy
mode is a display control, not encryption of the local cache.

## Reporting a problem

Do not attach auth files or unredacted snapshots to a public issue. Describe the
provider, platform, Tokmon version, and error first so maintainers can request a
minimal safe diagnostic.
