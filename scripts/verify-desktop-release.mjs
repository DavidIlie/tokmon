#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLATFORM_SPECS = {
  mac: {
    metadata: 'latest-mac.yml',
    artifacts(version) {
      return [
        `tokmon-desktop-${version}-mac-arm64.dmg`,
        `tokmon-desktop-${version}-mac-arm64.dmg.blockmap`,
        `tokmon-desktop-${version}-mac-arm64.zip`,
        `tokmon-desktop-${version}-mac-arm64.zip.blockmap`,
        `tokmon-desktop-${version}-mac-x64.dmg`,
        `tokmon-desktop-${version}-mac-x64.dmg.blockmap`,
        `tokmon-desktop-${version}-mac-x64.zip`,
        `tokmon-desktop-${version}-mac-x64.zip.blockmap`,
      ]
    },
    updateFiles(version) {
      return [
        `tokmon-desktop-${version}-mac-arm64.dmg`,
        `tokmon-desktop-${version}-mac-arm64.zip`,
        `tokmon-desktop-${version}-mac-x64.dmg`,
        `tokmon-desktop-${version}-mac-x64.zip`,
      ]
    },
  },
  win: {
    metadata: 'latest.yml',
    artifacts(version) {
      return [
        `tokmon-desktop-${version}-win-x64.exe`,
        `tokmon-desktop-${version}-win-x64.exe.blockmap`,
      ]
    },
    updateFiles(version) {
      return [`tokmon-desktop-${version}-win-x64.exe`]
    },
  },
  linux: {
    metadata: 'latest-linux.yml',
    artifacts(version) {
      return [
        `tokmon-desktop-${version}-linux-x86_64.AppImage`,
        `tokmon-desktop-${version}-linux-amd64.deb`,
      ]
    },
    updateFiles(version) {
      return [
        `tokmon-desktop-${version}-linux-x86_64.AppImage`,
        `tokmon-desktop-${version}-linux-amd64.deb`,
      ]
    },
  },
}

function scalar(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Parse the deliberately small electron-builder update metadata surface we validate. */
export function parseUpdateMetadata(source) {
  const result = { version: null, path: null, sha512: null, files: [] }
  let inFiles = false
  let current = null

  for (const line of source.split(/\r?\n/)) {
    const version = line.match(/^version:\s*(.+)$/)
    if (version) {
      result.version = scalar(version[1])
      continue
    }
    if (/^files:\s*$/.test(line)) {
      inFiles = true
      continue
    }
    if (inFiles) {
      const url = line.match(/^\s{2}-\s+url:\s*(.+)$/)
      if (url) {
        current = { url: scalar(url[1]), sha512: null, size: null }
        result.files.push(current)
        continue
      }
      const sha512 = line.match(/^\s{4}sha512:\s*(.+)$/)
      if (sha512 && current) {
        current.sha512 = scalar(sha512[1])
        continue
      }
      const size = line.match(/^\s{4}size:\s*(\d+)\s*$/)
      if (size && current) {
        current.size = Number(size[1])
        continue
      }
      if (/^\S/.test(line)) inFiles = false
    }
    const path = line.match(/^path:\s*(.+)$/)
    if (path) result.path = scalar(path[1])
    const sha512 = line.match(/^sha512:\s*(.+)$/)
    if (sha512) result.sha512 = scalar(sha512[1])
  }

  return result
}

function digest(path) {
  const hash = createHash('sha512')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const descriptor = openSync(path, 'r')
  try {
    let bytesRead
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('base64')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertSha512(value, label) {
  assert(typeof value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value), `${label} has no valid base64 sha512`)
  assert(Buffer.from(value, 'base64').length === 64, `${label} sha512 is not 512 bits`)
}

export function verifyPlatform({ platform, releaseDir, version }) {
  const spec = PLATFORM_SPECS[platform]
  assert(spec, `unsupported platform: ${platform}`)
  assert(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version), `invalid release version: ${version}`)

  const root = resolve(releaseDir)
  const required = spec.artifacts(version)
  for (const name of required) {
    const path = resolve(root, name)
    assert(existsSync(path), `${platform}: missing release artifact ${name}`)
    assert(statSync(path).isFile() && statSync(path).size > 0, `${platform}: empty release artifact ${name}`)
  }

  const metadataName = spec.metadata
  const metadataPath = resolve(root, metadataName)
  assert(existsSync(metadataPath), `${platform}: missing updater metadata ${metadataName}`)
  const metadata = parseUpdateMetadata(readFileSync(metadataPath, 'utf8'))
  assert(metadata.version === version, `${platform}: ${metadataName} version ${metadata.version ?? '<missing>'} != ${version}`)

  const expectedUpdateFiles = new Set(spec.updateFiles(version))
  const actualUpdateFiles = new Set(metadata.files.map(file => file.url))
  assert(metadata.files.length === expectedUpdateFiles.size, `${platform}: ${metadataName} has an unexpected number of update files`)
  for (const name of expectedUpdateFiles) {
    assert(actualUpdateFiles.has(name), `${platform}: ${metadataName} does not reference ${name}`)
  }

  for (const file of metadata.files) {
    assert(file.url === basename(file.url), `${platform}: updater URL must be a release-asset basename: ${file.url}`)
    assert(expectedUpdateFiles.has(file.url), `${platform}: unexpected updater file ${file.url}`)
    const path = resolve(root, file.url)
    const size = statSync(path).size
    assert(file.size === size, `${platform}: ${file.url} metadata size ${file.size ?? '<missing>'} != ${size}`)
    assertSha512(file.sha512, `${platform}: ${file.url}`)
    assert(file.sha512 === digest(path), `${platform}: ${file.url} metadata sha512 does not match the artifact`)
  }

  assert(metadata.path && expectedUpdateFiles.has(metadata.path), `${platform}: ${metadataName} path does not name an update file`)
  assertSha512(metadata.sha512, `${platform}: ${metadataName} top-level path`)
  assert(metadata.sha512 === digest(resolve(root, metadata.path)), `${platform}: ${metadataName} top-level sha512 does not match ${metadata.path}`)

  return { platform, metadata: metadataName, artifacts: required.length }
}

function readArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument near ${key ?? '<end>'}`)
    args[key.slice(2)] = value
  }
  return args
}

export function main(argv = process.argv.slice(2)) {
  const args = readArgs(argv)
  assert(args.platform, 'missing --platform (mac, win, linux, or all)')
  assert(args['release-dir'], 'missing --release-dir')
  assert(args.version, 'missing --version')
  const platforms = args.platform === 'all' ? Object.keys(PLATFORM_SPECS) : [args.platform]
  for (const platform of platforms) {
    const result = verifyPlatform({ platform, releaseDir: args['release-dir'], version: args.version })
    console.log(`verified ${result.platform}: ${result.artifacts} artifacts + ${result.metadata}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`desktop release verification failed: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
