import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectGemini } from './billing'
import { geminiPriceFor } from './usage'

test('Gemini pricing matches current standard rates', () => {
  assert.deepEqual(geminiPriceFor('gemini-3.5-flash'), { in: 0.75e-6, out: 4.5e-6, cr: 0.075e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3.1-flash-lite'), { in: 0.25e-6, out: 1.5e-6, cr: 0.025e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3.1-pro-preview'), { in: 2e-6, out: 12e-6, cr: 0.2e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3.1-pro-preview', 200_001), { in: 4e-6, out: 18e-6, cr: 0.4e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3-flash-preview'), { in: 0.5e-6, out: 3e-6, cr: 0.05e-6 })
})

test('gemini-2.5-pro applies the >200k long-context tier at the boundary', () => {
  // Standard tier through exactly 200k prompt tokens.
  assert.deepEqual(geminiPriceFor('gemini-2.5-pro'), { in: 1.25e-6, out: 10e-6, cr: 0.125e-6 })
  assert.deepEqual(geminiPriceFor('gemini-2.5-pro', 200_000), { in: 1.25e-6, out: 10e-6, cr: 0.125e-6 })
  // Long-context tier once the prompt exceeds 200k.
  assert.deepEqual(geminiPriceFor('gemini-2.5-pro', 200_001), { in: 2.5e-6, out: 15e-6, cr: 0.25e-6 })
})

test('gemini-3.1-pro keeps its existing long-context tier at the boundary', () => {
  assert.deepEqual(geminiPriceFor('gemini-3.1-pro', 200_000), { in: 2e-6, out: 12e-6, cr: 0.2e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3.1-pro', 200_001), { in: 4e-6, out: 18e-6, cr: 0.4e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3-pro', 200_001), { in: 4e-6, out: 18e-6, cr: 0.4e-6 })
  assert.deepEqual(geminiPriceFor('gemini-3-pro', 200_000), { in: 2e-6, out: 12e-6, cr: 0.2e-6 })
})

test('unknown Gemini models fall back to the flagship pro price, not zero', () => {
  const fallback = { in: 2e-6, out: 12e-6, cr: 0.2e-6 }
  assert.deepEqual(geminiPriceFor('gemini-3.1-flash'), fallback)
  assert.deepEqual(geminiPriceFor('gemini-9-ultra'), fallback)
  // The flagship long-context tier applies to unknown models over 200k too.
  assert.deepEqual(geminiPriceFor('gemini-3.1-flash', 200_001), { in: 4e-6, out: 18e-6, cr: 0.4e-6 })
})

test('Gemini detection accepts parseable JSON chat sessions', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tokmon-gemini-detect-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const chats = join(home, '.gemini', 'tmp', 'project', 'chats')
  await mkdir(chats, { recursive: true })
  await writeFile(join(chats, 'session-only.json'), '{}')

  assert.equal(await detectGemini(home), true)
})
