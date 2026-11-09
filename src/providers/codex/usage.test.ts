import assert from 'node:assert/strict'
import { appendFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { claudePriceFor } from '../claude/usage'
import { dedupe, loadCachedEntries } from '../usage-core'
import { codexPriceFor, parseFile } from './usage'

const line = (obj: unknown) => JSON.stringify(obj) + '\n'
const event = (type: string, fields: object = {}, second = 0) => line({
  timestamp: `2026-11-09T12:00:${String(second).padStart(2, '0')}Z`,
  type: 'event_msg', payload: { type, ...fields },
})
const total = (input: number, cached: number, output: number) => ({
  input_tokens: input, cached_input_tokens: cached, output_tokens: output,
  reasoning_output_tokens: 2, total_tokens: input + output,
})
const count = (usage: ReturnType<typeof total>, second: number, last?: ReturnType<typeof total>) =>
  event('token_count', { info: { total_token_usage: usage, last_token_usage: last } }, second)
const context = (model: string) => line({ type: 'turn_context', payload: { model } })
const tier = (service_tier: string) => event('thread_settings_applied', { thread_settings: { service_tier } })

test('Codex cached appends equal full parses through replay, tier changes, totals, and a split line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tokmon-codex-resume-'))
  try {
    const path = join(dir, 'rollout.jsonl')
    const u1 = total(100, 20, 10)
    const u2 = total(250, 50, 30)
    const split = count(total(400, 70, 60), 4)
    const boundary = split.indexOf('cached_input_tokens') + 9
    const parts = [
      line({ type: 'session_meta', payload: { source: 'thread_spawn', forked_from_id: 'parent' } })
        + context('gpt-5') + tier('ultrafast') + count(total(9000, 0, 500), 0),
      event('task_started', { started_at: '2026-11-09T12:00:01Z' }, 1)
        + context('gpt-6.1-sol') + tier('default') + count(u1, 2, u1) + tier('fast'),
      count(u1, 3, u1) + count(u2, 3)
        + context('vercel/kimi-k3') + split.slice(0, boundary),
      split.slice(boundary) + count(total(50, 5, 7), 5)
        + event('response', { model: 'claude-opus-5-5', usage: total(20, 5, 4) }, 6)
        + context('gpt-6-luna') + tier('ultrafast')
        + count(total(75, 10, 12), 7, total(25, 5, 5)),
    ]
    const ranges: [number, number][] = []
    const states: unknown[] = []
    const parseResume: typeof parseFile = async (file, start = 0, end, state) => {
      assert.equal(file, path)
      assert.notEqual(end, undefined)
      ranges.push([start, end!])
      states.push(state)
      // The carry is portable JSON data and must not depend on object identity.
      return parseFile(file, start, end, state && JSON.parse(JSON.stringify(state)))
    }
    const options = { storageDir: join(dir, 'cache'), parseResume }
    const full = async () => dedupe((await parseFile(path)).entries)
    let size = 0
    for (const [index, part] of parts.entries()) {
      if (index === 0) await writeFile(path, part)
      else await appendFile(path, part)
      size += Buffer.byteLength(part)
      const entries = await loadCachedEntries([{ path, size, mtimeMs: Date.now() + index }],
        async file => (await parseFile(file)).entries, 0, options)
      assert.deepEqual(entries, await full(), `revision ${index}`)
      if (index === 0) assert.deepEqual(entries, [])
    }
    assert.deepEqual(ranges.map(([start]) => start), [0, Buffer.byteLength(parts[0]), Buffer.byteLength(parts[0] + parts[1]), 0])
    assert.equal((states[1] as { skipReplay: boolean }).skipReplay, true)
    assert.equal((states[2] as { skipReplay: boolean }).skipReplay, false)
    const entries = await full()
    assert.deepEqual(entries.map(e => [e.model, e.input, e.cacheRead, e.output]), [
      ['gpt-6.1-sol', 80, 20, 10],
      ['gpt-6.1-sol (fast)', 120, 30, 20],
      ['vercel/kimi-k3 (fast)', 130, 20, 30],
      ['vercel/kimi-k3 (fast)', 45, 5, 7],
      ['claude-opus-5-5 (fast)', 15, 5, 4],
      ['gpt-6-luna (ultrafast)', 20, 5, 5],
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ordinary Codex rollouts resume after the fork-detection prefix', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tokmon-codex-prefix-'))
  try {
    const path = join(dir, 'rollout.jsonl')
    const starts: number[] = []
    const parseResume: typeof parseFile = (file, start = 0, end, state) => {
      starts.push(start)
      return parseFile(file, start, end, state)
    }
    const load = async (mtimeMs: number) => {
      const { size } = await stat(path)
      return loadCachedEntries([{ path, size, mtimeMs }], async file => (await parseFile(file)).entries,
        0, { storageDir: join(dir, 'cache'), parseResume })
    }
    await writeFile(path, line({ type: 'session_meta', payload: { instructions: 'x'.repeat(16 * 1024) } })
      + context('gpt-6.1-sol') + count(total(100, 20, 10), 1))
    await load(Date.now())
    const firstSize = (await stat(path)).size
    await appendFile(path, count(total(150, 30, 15), 2))
    const result = await load(Date.now() + 1)
    assert.deepEqual(result, (await parseFile(path)).entries)
    assert.deepEqual(result.map(e => e.input), [80, 40])
    assert.deepEqual(starts, [0, firstSize])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a short prefix is reparsed if later bytes reveal forked history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tokmon-codex-fork-'))
  try {
    const path = join(dir, 'rollout.jsonl')
    const load = async () => {
      const { size, mtimeMs } = await stat(path)
      return loadCachedEntries([{ path, size, mtimeMs }], async file => (await parseFile(file)).entries,
        0, { storageDir: join(dir, 'cache'), parseResume: parseFile })
    }
    await writeFile(path, context('gpt-6-sol') + count(total(100, 0, 10), 1))
    assert.equal((await load()).length, 1)
    await appendFile(path, line({ type: 'session_meta', payload: { source: 'thread_spawn', forked_from_id: 'parent' } }))
    assert.deepEqual(await load(), (await parseFile(path)).entries)
    assert.deepEqual(await load(), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

for (const [model, input, cached, output] of [
  ['kimi-k3', 3, 0.3, 15], ['kimi-k3.1-pro', 2, 0.2, 10],
  ['kimi-k3.1-pro-highspeed', 4, 0.2, 20], ['kimi-k2.6', 0.95, 0.16, 4],
  ['kimi-k2.7-code', 0.95, 0.19, 4], ['kimi-k2.7-code-highspeed', 1.9, 0.38, 8],
  ['glm-5.3', 1.4, 0.26, 4.4], ['glm-5.3-flash', 0.15, 0.03, 0.5],
  ['glm-5.3-flashx', 0.37, 0.075, 1.25], ['deepseek-v4.1-flash', 0.3, 0.006, 1.2],
] as const) {
  test(`Codex uses published prices for ${model} with or without a vendor prefix`, () => {
    const expected = { in: Number(`${input}e-6`), cr: Number(`${cached}e-6`), out: Number(`${output}e-6`) }
    for (const name of [model, `vercel/${model}`, ` VENDOR/${model.toUpperCase()} `]) {
      assert.deepEqual(codexPriceFor(name), expected)
    }
  })
}

test('Codex reuses Claude pricing including the long-prompt tier', () => {
  for (const model of ['claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-5-5']) {
    for (const input of [100, 100_001]) {
      const p = claudePriceFor(model, undefined, undefined, input)
      assert.deepEqual(codexPriceFor(`anthropic/${model}`, undefined, input), { in: p.i, cr: p.cr, out: p.o })
    }
  }
})

test('unknown vendor models retain the flagship fallback', () => {
  assert.deepEqual(codexPriceFor('vendor/unknown-model'), codexPriceFor('gpt-5.5'))
  assert.deepEqual(codexPriceFor('kimi-k2.5'), codexPriceFor('gpt-5.5'))
  assert.deepEqual(codexPriceFor('kimi-k3.2'), codexPriceFor('gpt-5.5'))
})
