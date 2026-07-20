# CLI queries

Query commands are meant for scripts and coding agents. They use the running
daemon when available and can start it when needed.

## Usage

```bash
tokmon usage
tokmon usage --period week --provider codex
tokmon usage --model opus --json
tokmon usage --period all --json --compact
```

`usage` refreshes local history by default. Use `--cached` for the fastest
known result or `--refresh` to refresh billing too.

JSON output includes:

- `schemaVersion`;
- provider and account source IDs;
- per-model input, output, cache, token, call, and cost fields;
- a `sources` collection mapping rows to provider homes and local paths.

Use `tokmon usage --help` for the current period and filter options.

## Providers

```bash
tokmon providers
tokmon providers --json
```

This reports configured accounts and provider source paths. Privacy-sensitive
automation should prefer redacted output or enable global privacy mode.

## Snapshot

```bash
tokmon snapshot
tokmon snapshot --refresh --compact --timeout 60
```

The snapshot is the complete daemon presentation contract used by the clients.
It is useful for debugging integrations; stable automation should prefer the
narrower `usage` and `providers` schemas.

## Configuration

```bash
tokmon config path
tokmon config get
tokmon config set --help
```

Configuration writes go through daemon compare-and-swap semantics, so a CLI
change cannot silently overwrite a newer desktop or web change.
