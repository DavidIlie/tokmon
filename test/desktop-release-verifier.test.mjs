import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { refreshMacReleaseMetadata } from '../scripts/refresh-macos-release-metadata.mjs'
import { verifyPlatform } from '../scripts/verify-desktop-release.mjs'

const version = '1.2.3'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'tokmon-release-'))
  const installer = `tokmon-desktop-${version}-win-x64.exe`
  const blockmap = `${installer}.blockmap`
  const bytes = Buffer.from('signed installer fixture')
  writeFileSync(join(directory, installer), bytes)
  writeFileSync(join(directory, blockmap), 'blockmap')
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  writeFileSync(join(directory, 'latest.yml'), [
    `version: ${version}`,
    'files:',
    `  - url: ${installer}`,
    `    sha512: ${sha512}`,
    `    size: ${bytes.length}`,
    `path: ${installer}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-07-15T00:00:00.000Z'",
    '',
  ].join('\n'))
  return { directory, installer, blockmap }
}

test('accepts complete electron-builder artifacts with matching metadata', t => {
  const { directory } = fixture()
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  assert.deepEqual(verifyPlatform({ platform: 'win', releaseDir: directory, version }), {
    platform: 'win', metadata: 'latest.yml', artifacts: 2,
  })
})

test('rejects a release missing its differential-update blockmap', t => {
  const { directory, blockmap } = fixture()
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  rmSync(join(directory, blockmap))
  assert.throws(
    () => verifyPlatform({ platform: 'win', releaseDir: directory, version }),
    /missing release artifact .*\.blockmap/,
  )
})

test('rejects updater metadata that does not match the published bytes', t => {
  const { directory, installer } = fixture()
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(join(directory, installer), 'mutated after metadata generation')
  assert.throws(
    () => verifyPlatform({ platform: 'win', releaseDir: directory, version }),
    /metadata size .* !=/,
  )
})

test('refreshes notarized DMG metadata and differential blockmaps', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tokmon-mac-release-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  const files = [
    `tokmon-desktop-${version}-mac-x64.zip`,
    `tokmon-desktop-${version}-mac-arm64.zip`,
    `tokmon-desktop-${version}-mac-x64.dmg`,
    `tokmon-desktop-${version}-mac-arm64.dmg`,
  ]
  for (const file of files) {
    writeFileSync(join(directory, file), `notarized ${file}`)
    writeFileSync(join(directory, `${file}.blockmap`), 'stale blockmap')
  }
  writeFileSync(join(directory, 'latest-mac.yml'), [
    `version: ${version}`,
    'files:',
    ...files.flatMap(file => [
      `  - url: ${file}`,
      '    sha512: c3RhbGU=',
      '    size: 1',
    ]),
    `path: ${files[0]}`,
    'sha512: c3RhbGU=',
    "releaseDate: '2026-07-20T00:00:00.000Z'",
    '',
  ].join('\n'))

  const rebuilt = []
  await refreshMacReleaseMetadata({
    releaseDir: directory,
    async buildBlockMap(input, format, output) {
      rebuilt.push({ input, format, output })
      writeFileSync(output, `blockmap for ${readFileSync(input, 'utf8')}`)
    },
  })

  assert.equal(rebuilt.length, 2)
  assert(rebuilt.every(call => call.format === 'gzip' && call.output.endsWith('.dmg.blockmap')))
  assert.doesNotThrow(() => verifyPlatform({ platform: 'mac', releaseDir: directory, version }))
})
