import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGrokAuth } from './identity'

test('alternate Grok homes ignore default-account environment credentials', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tokmon-grok-'))
  const oldInline = process.env.GROK_AUTH
  const oldPath = process.env.GROK_AUTH_PATH
  try {
    await writeFile(join(home, 'auth.json'), JSON.stringify({ key: 'alt-token', email: 'alt@example.com' }))
    process.env.GROK_AUTH = JSON.stringify({ key: 'default-inline', email: 'default@example.com' })
    process.env.GROK_AUTH_PATH = join(home, 'missing-default-auth.json')
    assert.equal(readGrokAuth(home)?.key, 'alt-token')
    assert.equal(readGrokAuth(home)?.email, 'alt@example.com')
  } finally {
    if (oldInline === undefined) delete process.env.GROK_AUTH
    else process.env.GROK_AUTH = oldInline
    if (oldPath === undefined) delete process.env.GROK_AUTH_PATH
    else process.env.GROK_AUTH_PATH = oldPath
    await rm(home, { recursive: true, force: true })
  }
})
