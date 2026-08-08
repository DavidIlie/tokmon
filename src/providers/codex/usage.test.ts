import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexPriceFor, codexTable } from './usage'

test('Codex priority service tier doubles every token class', () => {
  const standard = codexPriceFor('gpt-5.6-sol')
  assert.deepEqual(codexPriceFor('gpt-5.6-sol', 'priority'), {
    in: standard.in * 2, cr: standard.cr * 2, out: standard.out * 2,
  })
  assert.deepEqual(codexPriceFor('gpt-5.6-sol', 'default'), standard)
  assert.deepEqual(codexPriceFor('gpt-5.6-sol', undefined), standard)
})

test('Codex pricing matches current short-context standard rates', () => {
  assert.deepEqual(codexPriceFor('gpt-5.6-sol'), { in: 5e-6, cr: 0.5e-6, out: 30e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.6-terra'), { in: 2.5e-6, cr: 0.25e-6, out: 15e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.6-luna'), { in: 1e-6, cr: 0.1e-6, out: 6e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.5-pro'), { in: 30e-6, cr: 30e-6, out: 180e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.4-mini'), { in: 0.75e-6, cr: 0.075e-6, out: 4.5e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.4-nano'), { in: 0.2e-6, cr: 0.02e-6, out: 1.25e-6 })
  assert.deepEqual(codexPriceFor('gpt-5.4-pro'), { in: 30e-6, cr: 30e-6, out: 180e-6 })
})

test('Codex pricing does not let a shorter family prefix claim a newer model', () => {
  assert.deepEqual(codexPriceFor('openai/gpt-5.6-terra-2026-07-09'), { in: 2.5e-6, cr: 0.25e-6, out: 15e-6 })
})

test('Codex spawned sessions exclude replayed history that crosses a timestamp second', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tokmon-codex-replay-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const sessions = join(home, '.codex', 'sessions')
  await mkdir(sessions, { recursive: true })

  const second = Math.floor(Date.now() / 1000) * 1000 - 10_000
  const replayFirst = second + 999
  const replaySpill = second + 1_000
  const liveStart = second + 2_000
  const tokenCount = (timestamp: number, input: number, cached: number, output: number) => ({
    timestamp: new Date(timestamp).toISOString(),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
        total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
      },
    },
  })
  const lines = [
    {
      timestamp: new Date(second).toISOString(),
      type: 'session_meta',
      payload: {
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } },
        forked_from_id: 'parent',
      },
    },
    { timestamp: new Date(second).toISOString(), type: 'session_meta', payload: { source: 'vscode' } },
    {
      timestamp: new Date(second).toISOString(),
      type: 'event_msg',
      payload: { type: 'task_started', started_at: Math.floor(second / 1000) - 60, turn_id: 'replayed' },
    },
    tokenCount(replayFirst, 100, 80, 10),
    tokenCount(replayFirst, 200, 160, 20),
    tokenCount(replaySpill, 300, 240, 30),
    {
      timestamp: new Date(liveStart).toISOString(),
      type: 'event_msg',
      payload: { type: 'task_started', started_at: liveStart / 1000, turn_id: 'live' },
    },
    { timestamp: new Date(liveStart + 1).toISOString(), type: 'turn_context', payload: { model: 'gpt-5.5' } },
    tokenCount(liveStart + 2, 40, 30, 5),
  ]
  await writeFile(join(sessions, 'spawned.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n')

  const table = await codexTable('UTC', home)
  assert.equal(table.daily.length, 1)
  assert.equal(table.daily[0].total, 45)
  assert.equal(table.daily[0].count, 1)
})
