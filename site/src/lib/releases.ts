// Latest-release model + artifact picker for the download surfaces.
//
// The desktop artifacts are produced by src/desktop/electron-builder.yml with
// artifactName `tokmon-desktop-${version}-${os}-${arch}.${ext}`. The concrete
// basenames (per the release workflow) are:
//   tokmon-desktop-${v}-mac-arm64.dmg
//   tokmon-desktop-${v}-mac-x64.dmg
//   tokmon-desktop-${v}-win-x64.exe
//   tokmon-desktop-${v}-linux-x86_64.AppImage
//   tokmon-desktop-${v}-linux-amd64.deb
// pickAsset() matches these by shape (version-agnostic) so it keeps working as
// versions bump. Everything here is pure and DOM-free so node:test can drive it;
// browser-only fetch/sessionStorage live in the guarded functions at the bottom.

import { RELEASES_URL, REPO_SLUG } from "./site.ts";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export interface Release {
  tag_name: string;
  name: string | null;
  html_url: string;
  body: string | null;
  assets: ReleaseAsset[];
}

export type PlatformKey =
  | "mac-arm64"
  | "mac-x64"
  | "win-x64"
  | "linux-appimage"
  | "linux-deb";

export interface PlatformTarget {
  key: PlatformKey;
  os: "macOS" | "Windows" | "Linux";
  label: string;
  sublabel: string;
  ext: string;
  pattern: RegExp;
}

export const PLATFORM_TARGETS: PlatformTarget[] = [
  {
    key: "mac-arm64",
    os: "macOS",
    label: "macOS · Apple Silicon",
    sublabel: "arm64 · signed .dmg",
    ext: "dmg",
    pattern: /^tokmon-desktop-.+-mac-arm64\.dmg$/,
  },
  {
    key: "mac-x64",
    os: "macOS",
    label: "macOS · Intel",
    sublabel: "x64 · signed .dmg",
    ext: "dmg",
    pattern: /^tokmon-desktop-.+-mac-x64\.dmg$/,
  },
  {
    key: "win-x64",
    os: "Windows",
    label: "Windows",
    sublabel: "x64 · signed .exe installer",
    ext: "exe",
    pattern: /^tokmon-desktop-.+-win-x64\.exe$/,
  },
  {
    key: "linux-appimage",
    os: "Linux",
    label: "Linux · AppImage",
    sublabel: "x86_64 · portable",
    ext: "AppImage",
    pattern: /^tokmon-desktop-.+-linux-x86_64\.AppImage$/,
  },
  {
    key: "linux-deb",
    os: "Linux",
    label: "Linux · Debian / Ubuntu",
    sublabel: "amd64 · .deb package",
    ext: "deb",
    pattern: /^tokmon-desktop-.+-linux-amd64\.deb$/,
  },
];

/**
 * Return the matching asset for a platform, or null when the release has no such
 * artifact. GitHub payload validation belongs to normalizeRelease().
 */
export function pickAsset(
  assets: readonly ReleaseAsset[],
  key: PlatformKey,
): ReleaseAsset | null {
  const target = PLATFORM_TARGETS.find((candidate) => candidate.key === key);
  if (!target) return null;
  return assets.find(({ name }) => target.pattern.test(name)) ?? null;
}

/** True when at least one desktop installer is attached to the release. */
export function hasAnyDesktopAsset(release: Release | null): boolean {
  if (!release) return false;
  return PLATFORM_TARGETS.some((t) => pickAsset(release.assets, t.key) !== null);
}

/**
 * Coerce an arbitrary GitHub API payload into a Release, or null when it is not
 * a usable release object (missing tag, wrong shape, malformed JSON upstream).
 * Never throws — the network/UI layers treat null as "unknown, use fallback".
 */
export function normalizeRelease(data: unknown): Release | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.tag_name !== "string" || obj.tag_name.length === 0) return null;
  const rawAssets = Array.isArray(obj.assets) ? obj.assets : [];
  const assets: ReleaseAsset[] = [];
  for (const raw of rawAssets) {
    if (!raw || typeof raw !== "object") continue;
    const name = (raw as { name?: unknown }).name;
    const url = (raw as { browser_download_url?: unknown }).browser_download_url;
    if (typeof name !== "string" || typeof url !== "string") continue;
    const size = (raw as { size?: unknown }).size;
    assets.push({
      name,
      browser_download_url: url,
      size: typeof size === "number" ? size : undefined,
    });
  }
  return {
    tag_name: obj.tag_name,
    name: typeof obj.name === "string" ? obj.name : null,
    html_url:
      typeof obj.html_url === "string"
        ? obj.html_url
        : RELEASES_URL,
    body: typeof obj.body === "string" ? obj.body : null,
    assets,
  };
}

const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;
const CACHE_KEY = "tokmon:latest-release:v1";

/**
 * Fetch the latest release, memoised in sessionStorage for the tab's lifetime.
 * Browser-only (guards `sessionStorage`/`fetch`); returns null on any failure so
 * callers keep their safe server-rendered fallback. Never throws.
 */
export async function fetchLatestRelease(): Promise<Release | null> {
  const store =
    typeof sessionStorage !== "undefined" ? sessionStorage : undefined;

  if (store) {
    try {
      const cached = store.getItem(CACHE_KEY);
      if (cached) {
        const parsed = normalizeRelease(JSON.parse(cached));
        if (parsed) return parsed;
      }
    } catch {
      /* ignore corrupt cache */
    }
  }

  if (typeof fetch === "undefined") return null;

  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const release = normalizeRelease(await res.json());
    if (release && store) {
      try {
        store.setItem(CACHE_KEY, JSON.stringify(release));
      } catch {
        /* storage full / disabled — non-fatal */
      }
    }
    return release;
  } catch {
    return null;
  }
}
