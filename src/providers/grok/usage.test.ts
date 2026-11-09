import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseUnifiedLog } from './usage'

for (const [model, inputRate, cacheRate, outputRate] of [
  ['grok-4.7', 2, 0.5, 6],
  ['grok-4.6', 2, 0.5, 6],
  ['grok-4.5', 2, 0.3, 6],
  ['grok-build-latest', 2, 0.3, 6],
  ['grok-4.3', 1.25, 0.2, 2.5],
  ['grok-4.20', 1.25, 0.2, 2.5],
  ['grok-code-fast-1', 1, 0.2, 2],
] as const) {
  test(`${model} prices each request at the 200k boundary, including cached prompt tokens`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'tokmon-grok-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'unified.jsonl')
    await writeFile(path, [200_000, 200_001].map((prompt, i) => JSON.stringify({
      sid: 'session', ts: `2026-11-09T10:00:0${i}Z`, msg: 'shell.turn.inference_done',
      ctx: { prompt_tokens: prompt, cached_prompt_tokens: 100_000, completion_tokens: 1000, loop_index: i },
    })).join('\n'))
    const entries = await parseUnifiedLog(path, new Map([['session', model]]))
    assert.equal(entries.length, 2)
    for (const [i, multiplier] of [[0, 1], [1, 2]]) {
      const expected = ((100_000 + i) * inputRate + 100_000 * cacheRate + 1000 * outputRate) * multiplier / 1e6
      assert.ok(Math.abs(entries[i].cost - expected) < 1e-12)
      assert.ok(Math.abs(entries[i].cacheSavings - 100_000 * (inputRate - cacheRate) * multiplier / 1e6) < 1e-12)
    }
  })
}
