# Releasing

Tokmon publishes desktop installers and two npm packages from one version tag.
The root package version, desktop package version, and tag must match.

## Required macOS secrets

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

The workflow fails if they are missing. It signs and notarizes both app bundles,
then separately notarizes and staples the DMG containers. Because stapling
changes the DMG bytes, the workflow rebuilds their differential blockmaps and
refreshes the updater metadata before verification.

Windows Authenticode is optional through `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD`. Without them, the workflow publishes an unsigned
Windows installer. Linux packages are unsigned.

## Tag flow

1. Update both package versions and release notes.
2. Run the full checks and builds.
3. Create and push an annotated `vX.Y.Z` tag.
4. The desktop workflow builds macOS, Windows, and Linux in parallel.
5. The release verifier checks file names, sizes, SHA-512 values, updater YAML,
   blockmaps, platform signatures, and notarization tickets.
6. The workflow creates the GitHub Release and downloads it again for a final
   verification.
7. Only then does the reusable publish workflow release `tokmon` to npm and
   `@davidilie/tokmon` to GitHub Packages.
8. Last, the Homebrew tap is updated to the new version.

## Homebrew

`brew install --cask davidilie/tap/tokmon` installs the desktop app and
`brew install davidilie/tap/tokmon-cli` the terminal CLI, both from the
`DavidIlie/homebrew-tap` repository. After a tag has published its installers
and npm package, the `homebrew` job renders `Casks/tokmon.rb` and
`Formula/tokmon-cli.rb` with `scripts/render-homebrew.mjs` and pushes them to
the tap. The job does nothing until the `HOMEBREW_TAP_TOKEN` secret exists: a
fine-grained token with contents write access to the tap repository only.

To repair or seed the tap by hand from any published version:

```bash
node scripts/render-homebrew.mjs --version 0.32.2 --tap ../homebrew-tap
```

The official `homebrew/cask` repository only accepts apps that meet its
notability bar, so the tap is the supported channel until Tokmon does.

## Artifacts

Expected release files include:

- arm64 and x64 macOS DMG/ZIP files and blockmaps;
- x64 Windows installer and blockmap;
- x64 Linux AppImage and Debian package;
- `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.

## Repairing a release

The Desktop Release workflow accepts an existing tag through manual dispatch.
This rebuilds and replaces an incomplete release without moving the tag. Manual
repair intentionally skips package registries.

If the original tag run stopped before package publication, dispatch the
Publish workflow on that tag only after the repaired GitHub Release passes all
verification.

Never move a published tag to hide a release fix. Put workflow-only repair code
on the default branch and use manual dispatch, or create a new patch version
when the application source itself changes.
