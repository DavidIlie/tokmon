import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { flushDisk, lastDayKeys, loadCachedEntries, tabulate, type Entry } from './usage-core'

test('calendar-day series remain unique and consecutive across DST changes', () => {
  assert.deepEqual(
    lastDayKeys(Date.parse('2026-03-10T12:00:00Z'), 'America/New_York', 4),
    ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'],
  )
  assert.deepEqual(
    lastDayKeys(Date.parse('2026-11-03T12:00:00Z'), 'America/New_York', 4),
    ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'],
  )
})

test('request counts survive aggregation and the persisted row codec', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tokmon-usage-core-'))
  try {
    const entry: Entry = {
      ts: Date.parse('2026-07-09T12:00:00Z'), model: 'test-model', count: 7,
      cost: 1, input: 2, output: 3, cacheCreate: 4, cacheRead: 5, cacheSavings: 6,
    }
    const parse = async () => [entry]
    const loaded = await loadCachedEntries(
      [{ path: join(dir, 'source.jsonl'), mtimeMs: 1, size: 1 }],
      parse,
      0,
      { storageDir: dir, fingerprint: { format: 'count-test', parser: 'count-test', pricing: 'count-test' } },
    )
    assert.equal(tabulate(loaded, 'UTC').daily[0]?.count, 7)
    await flushDisk()

    const root = join(dir, 'usage-shards')
    const namespace = (await readdir(root))[0]
    const shard = (await readdir(join(root, namespace))).find(name => name.endsWith('.json'))
    assert.ok(shard)
    const disk = JSON.parse(await readFile(join(root, namespace, shard), 'utf8')) as {
      entries: { rows: unknown[][] }
    }
    assert.equal(disk.entries.rows[0]?.[9], 7)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
