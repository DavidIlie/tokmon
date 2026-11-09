import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { detectGemini, geminiCredsPath, geminiDir } from './billing'
import { geminiPriceFor, geminiTable, geminiTmpDir } from './usage'

test('GEMINI_CLI_HOME applies to credentials and session discovery; explicit home wins', async (t) => {
  const originalEnv = ["GEMINI_CLI_HOME"].map(key => [key, process.env[key]] as const)
  t.after(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const root = await mkdtemp(join(tmpdir(), 'tokmon-gemini-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  process.env.GEMINI_CLI_HOME = root
  assert.equal(geminiCredsPath(), join(root, '.gemini/oauth_creds.json'))
  assert.equal(geminiTmpDir(), join(root, '.gemini/tmp'))
  assert.equal(geminiDir('/account'), join('/account', '.gemini'))
  const chats = join(root, '.gemini/tmp/project/chats')
  await mkdir(chats, { recursive: true })
  await writeFile(join(chats, 'session-test.json'), JSON.stringify({ messages: [
    { id: 'before', type: 'gemini', model: 'gemini-4-argon', timestamp: '2026-11-30T23:59:59.999Z', tokens: { input: 1000, cached: 400, output: 90, thoughts: 10 } },
    { id: 'after', type: 'gemini', model: 'gemini-4-argon', timestamp: '2026-12-01T00:00:00.000Z', tokens: { input: 1000, cached: 400, output: 90, thoughts: 10 } },
  ] }))
  assert.equal(await detectGemini(), true)
  const table = await geminiTable('UTC')
  assert.equal(table.daily.length, 2)
  const before = table.daily.find(row => row.label === '2026-11-30')!
  const after = table.daily.find(row => row.label === '2026-12-01')!
  assert.ok(Math.abs(before.cost - 0.00224) < 1e-12)
  assert.ok(Math.abs(after.cost - 0.00448) < 1e-12)
  assert.equal((await geminiTable('UTC', join(root, 'other-account'))).daily.length, 0)
  process.env.GEMINI_CLI_HOME = '~/literal'
  assert.equal(geminiDir(), join('~/literal', '.gemini'))
  process.env.GEMINI_CLI_HOME = ''
  assert.equal(geminiDir(), join(homedir(), '.gemini'))
})

for (const [model, cutoff, before, after] of [
  ['gemini-4-argon', '2026-12-01T00:00:00Z', [2, 10, 0.1], [4, 20, 0.2]],
  ['gemini-3.8-flash', '2027-01-01T00:00:00Z', [0.75, 3.75, 0.075], [1.5, 7.5, 0.15]],
  ['gemini-3.6-flash', '2027-01-01T00:00:00Z', [0.75, 3.75, 0.075], [1.5, 7.5, 0.15]],
] as const) {
  test(`${model} uses the event timestamp at the promotional cutoff`, () => {
    const boundary = Date.parse(cutoff)
    for (const [ts, values] of [[boundary - 1, before], [boundary, after]] as const) {
      const price = geminiPriceFor(model, 300_000, ts)
      assert.ok(Math.abs(price.in * 1e6 - values[0]) < 1e-10)
      assert.ok(Math.abs(price.out * 1e6 - values[1]) < 1e-10)
      assert.ok(Math.abs(price.cr * 1e6 - values[2]) < 1e-10)
    }
  })
}

test('Flash-Lite resolves before Flash and Pro tiers change strictly above 200k tokens', () => {
  assert.equal(geminiPriceFor('gemini-3.5-flash-lite-preview').in, 0.3e-6)
  assert.equal(geminiPriceFor('gemini-3.5-flash-lite').out, 2.5e-6)
  for (const [model, short, long] of [
    ['gemini-3.1-pro-preview', [2, 12, 0.2], [4, 18, 0.4]],
    ['gemini-2.5-pro', [1.25, 10, 0.125], [2.5, 15, 0.25]],
  ] as const) {
    for (const [tokens, rates] of [[200_000, short], [200_001, long]] as const) {
      const price = geminiPriceFor(model, tokens)
      assert.ok(Math.abs(price.in * 1e6 - rates[0]) < 1e-10)
      assert.ok(Math.abs(price.out * 1e6 - rates[1]) < 1e-10)
      assert.ok(Math.abs(price.cr * 1e6 - rates[2]) < 1e-10)
    }
  }
})
