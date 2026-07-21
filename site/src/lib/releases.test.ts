import { test } from "node:test";
import assert from "node:assert/strict";
import rootPackage from "../../../package.json" with { type: "json" };
import {
  pickAsset,
  normalizeRelease,
  normalizeCachedRelease,
  hasAnyDesktopAsset,
  PLATFORM_TARGETS,
  type PlatformKey,
  type Release,
} from "./releases.ts";
import { FALLBACK_VERSION } from "./site.ts";

const VERSION = "0.28.2";

test("the static fallback follows the repository release version", () => {
  assert.equal(FALLBACK_VERSION, `v${rootPackage.version}`);
});

test("release cache entries expire so an open tab discovers a new release", () => {
  const now = 1_000_000;
  const release = { tag_name: "v0.28.5", assets: [] };
  assert.equal(normalizeCachedRelease({ cachedAt: now - 60_000, release }, now)?.tag_name, "v0.28.5");
  assert.equal(normalizeCachedRelease({ cachedAt: now - 10 * 60_000, release }, now), null);
  assert.equal(normalizeCachedRelease(release, now), null);
});

// The full set of real electron-builder basenames for a given version.
function assetsFor(version: string) {
  return [
    `tokmon-desktop-${version}-mac-arm64.dmg`,
    `tokmon-desktop-${version}-mac-x64.dmg`,
    `tokmon-desktop-${version}-win-x64.exe`,
    `tokmon-desktop-${version}-linux-x86_64.AppImage`,
    `tokmon-desktop-${version}-linux-amd64.deb`,
  ].map((name) => ({
    name,
    browser_download_url: `https://example.test/${name}`,
    size: 1234,
  }));
}

const EXPECTED: Record<PlatformKey, string> = {
  "mac-arm64": `tokmon-desktop-${VERSION}-mac-arm64.dmg`,
  "mac-x64": `tokmon-desktop-${VERSION}-mac-x64.dmg`,
  "win-x64": `tokmon-desktop-${VERSION}-win-x64.exe`,
  "linux-appimage": `tokmon-desktop-${VERSION}-linux-x86_64.AppImage`,
  "linux-deb": `tokmon-desktop-${VERSION}-linux-amd64.deb`,
};

test("pickAsset matches every platform to its artifact", () => {
  const assets = assetsFor(VERSION);
  for (const target of PLATFORM_TARGETS) {
    const picked = pickAsset(assets, target.key);
    assert.ok(picked, `expected an asset for ${target.key}`);
    assert.equal(picked!.name, EXPECTED[target.key]);
  }
});

test("pickAsset stays version-agnostic across a bump", () => {
  const assets = assetsFor("1.4.0");
  const picked = pickAsset(assets, "mac-arm64");
  assert.equal(picked!.name, "tokmon-desktop-1.4.0-mac-arm64.dmg");
});

test("pickAsset does not cross platforms (arm64 vs x64, appimage vs deb)", () => {
  const armOnly = [
    {
      name: `tokmon-desktop-${VERSION}-mac-arm64.dmg`,
      browser_download_url: "https://example.test/a",
    },
  ];
  assert.equal(pickAsset(armOnly, "mac-x64"), null);

  const appImageOnly = [
    {
      name: `tokmon-desktop-${VERSION}-linux-x86_64.AppImage`,
      browser_download_url: "https://example.test/b",
    },
  ];
  assert.equal(pickAsset(appImageOnly, "linux-deb"), null);
  assert.ok(pickAsset(appImageOnly, "linux-appimage"));
});

test("pickAsset returns null for every platform when assets are empty", () => {
  for (const target of PLATFORM_TARGETS) {
    assert.equal(pickAsset([], target.key), null);
  }
});

test("normalizeRelease rejects malformed API responses", () => {
  assert.equal(normalizeRelease(null), null);
  assert.equal(normalizeRelease(undefined), null);
  assert.equal(normalizeRelease("boom"), null);
  assert.equal(normalizeRelease(42), null);
  assert.equal(normalizeRelease({}), null); // no tag_name
  assert.equal(normalizeRelease({ tag_name: "" }), null); // empty tag
  assert.equal(normalizeRelease({ tag_name: 5 }), null); // wrong type
});

test("normalizeRelease coerces a minimal valid payload and drops junk assets", () => {
  const rel = normalizeRelease({
    tag_name: "v0.28.2",
    assets: [
      "junk",
      { name: "ok.dmg", browser_download_url: "https://example.test/ok" },
      { name: "no-url" },
    ],
  });
  assert.ok(rel);
  assert.equal(rel!.tag_name, "v0.28.2");
  assert.equal(rel!.name, null);
  assert.equal(rel!.body, null);
  assert.equal(rel!.assets.length, 1);
  assert.equal(rel!.assets[0]!.name, "ok.dmg");
});

test("hasAnyDesktopAsset reflects the current zero-asset release truthfully", () => {
  const zeroAsset: Release = {
    tag_name: "v0.28.2",
    name: "tokmon v0.28.2",
    html_url: "https://github.com/DavidIlie/tokmon/releases/tag/v0.28.2",
    body: "changelog",
    assets: [],
  };
  assert.equal(hasAnyDesktopAsset(zeroAsset), false);
  assert.equal(hasAnyDesktopAsset(null), false);

  const withAssets: Release = { ...zeroAsset, assets: assetsFor(VERSION) };
  assert.equal(hasAnyDesktopAsset(withAssets), true);
});
