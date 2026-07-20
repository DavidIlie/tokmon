import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
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
