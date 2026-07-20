#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseUpdateMetadata } from './verify-desktop-release.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))

async function hashFile(path) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64')
}

function loadBlockMapBuilder() {
  const desktopRequire = createRequire(resolve(scriptDirectory, '../src/desktop/package.json'))
  const electronBuilderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'))
  return electronBuilderRequire('app-builder-lib/out/targets/blockmap/blockmap').buildBlockMap
}

function replaceMetadataChecksums(source, updates, topLevelSha512) {
  let currentUrl = null
  let inFiles = false

  return source.split(/\r?\n/).map(line => {
    if (/^files:\s*$/.test(line)) {
      inFiles = true
      return line
    }

    if (inFiles) {
      const url = line.match(/^\s{2}-\s+url:\s*(.+)$/)
      if (url) {
        currentUrl = url[1].trim().replace(/^['"]|['"]$/g, '')
        return line
      }

      const update = currentUrl && updates.get(currentUrl)
      if (update && /^\s{4}sha512:/.test(line)) return `    sha512: ${update.sha512}`
      if (update && /^\s{4}size:/.test(line)) return `    size: ${update.size}`

      if (/^\S/.test(line)) {
        inFiles = false
        currentUrl = null
      }
    }

    if (/^sha512:/.test(line)) return `sha512: ${topLevelSha512}`
    return line
  }).join('\n')
}

export async function refreshMacReleaseMetadata({
  releaseDir,
  metadataName = 'latest-mac.yml',
  buildBlockMap = loadBlockMapBuilder(),
}) {
  const root = resolve(releaseDir)
  const metadataPath = resolve(root, metadataName)
  const source = await readFile(metadataPath, 'utf8')
  const metadata = parseUpdateMetadata(source)
  for (const { url } of metadata.files) {
    if (url !== basename(url)) throw new Error(`updater URL must be a release-asset basename: ${url}`)
  }
  const dmgs = metadata.files.filter(file => file.url.endsWith('.dmg'))

  if (dmgs.length !== 2) throw new Error(`expected two DMGs in ${metadataName}, found ${dmgs.length}`)
  for (const arch of ['arm64', 'x64']) {
    const matches = dmgs.filter(file => file.url.endsWith(`-mac-${arch}.dmg`))
    if (matches.length !== 1) throw new Error(`expected one ${arch} DMG in ${metadataName}, found ${matches.length}`)
  }

  for (const { url } of dmgs) {
    const dmgPath = resolve(root, url)
    await buildBlockMap(dmgPath, 'gzip', `${dmgPath}.blockmap`)
  }

  const updates = new Map()
  for (const { url } of metadata.files) {
    const path = resolve(root, url)
    updates.set(url, {
      sha512: await hashFile(path),
      size: (await stat(path)).size,
    })
  }

  const topLevel = updates.get(metadata.path)
  if (!topLevel) throw new Error(`${metadataName} path does not reference a files entry: ${metadata.path ?? '<missing>'}`)

  const refreshed = replaceMetadataChecksums(source, updates, topLevel.sha512)
  const temporaryPath = `${metadataPath}.tmp`
  await writeFile(temporaryPath, refreshed)
  await rename(temporaryPath, metadataPath)

  return { metadata: metadataName, dmgs: dmgs.length }
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

async function main(argv = process.argv.slice(2)) {
  const args = readArgs(argv)
  if (!args['release-dir']) throw new Error('missing --release-dir')
  const result = await refreshMacReleaseMetadata({ releaseDir: args['release-dir'] })
  console.log(`refreshed ${result.dmgs} notarized DMGs + ${result.metadata}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`macOS release metadata refresh failed: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
