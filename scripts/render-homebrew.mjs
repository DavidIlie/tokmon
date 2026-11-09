#!/usr/bin/env node
// Renders the Homebrew cask (desktop app) and formula (CLI) for one published
// release into a tap checkout. Checksums come from the published artifacts, so
// this can only describe a release that already exists.
//
//   node scripts/render-homebrew.mjs --version 0.33.1 --tap ../homebrew-tap
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'DavidIlie/tokmon'

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const version = (option('version') ?? '').replace(/^v/, '')
const tap = option('tap')
if (!/^\d+\.\d+\.\d+$/.test(version) || !tap) {
  console.error('usage: render-homebrew.mjs --version <x.y.z> --tap <tap checkout>')
  process.exit(1)
}

async function sha256Of(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`)
  const hash = createHash('sha256')
  for await (const chunk of response.body) hash.update(chunk)
  return hash.digest('hex')
}

const dmg = arch => `https://github.com/${REPO}/releases/download/v${version}/tokmon-desktop-${version}-mac-${arch}.dmg`
const tarball = `https://registry.npmjs.org/tokmon/-/tokmon-${version}.tgz`
const [arm, intel, cli] = await Promise.all([sha256Of(dmg('arm64')), sha256Of(dmg('x64')), sha256Of(tarball)])

const cask = `cask "tokmon" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${arm}",
         intel: "${intel}"

  url "https://github.com/${REPO}/releases/download/v#{version}/tokmon-desktop-#{version}-mac-#{arch}.dmg",
      verified: "github.com/${REPO}/"
  name "Tokmon"
  desc "Menu-bar usage, limit and cost monitor for AI coding tools"
  homepage "https://github.com/${REPO}"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :monterey"

  app "Tokmon.app"

  uninstall quit: "com.davidilie.tokmon"

  zap trash: [
    "~/.config/tokmon",
    "~/Library/Application Support/Tokmon",
    "~/Library/Caches/com.davidilie.tokmon",
    "~/Library/Caches/com.davidilie.tokmon.ShipIt",
    "~/Library/Caches/tokmon",
    "~/Library/Preferences/com.davidilie.tokmon.plist",
    "~/Library/Saved Application State/com.davidilie.tokmon.savedState",
  ]
end
`

const formula = `class TokmonCli < Formula
  desc "Terminal and web dashboard for AI coding tool usage, limits and costs"
  homepage "https://github.com/${REPO}"
  url "${tarball}"
  sha256 "${cli}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match "tokmon", shell_output("#{bin}/tokmon --help")
  end
end
`

mkdirSync(join(tap, 'Casks'), { recursive: true })
mkdirSync(join(tap, 'Formula'), { recursive: true })
writeFileSync(join(tap, 'Casks', 'tokmon.rb'), cask)
writeFileSync(join(tap, 'Formula', 'tokmon-cli.rb'), formula)
console.log(`rendered tokmon ${version} into ${tap}`)
