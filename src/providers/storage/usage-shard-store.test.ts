import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { UsageShardStore, type UsageCacheFingerprint } from './usage-shard-store'

type Row = { id: string; value: number }

const fingerprint: UsageCacheFingerprint = { format: 'test-format', parser: 'parser-1', pricing: 'prices-1' }
const NOW = 1_000_000
const source = (path = '/logs/session.jsonl', mtimeMs = NOW - 1, size = 100) => ({ path, mtimeMs, size })

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'tokmon-usage-store-'))
  try { await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

function store(dir: string, overrides: Partial<ConstructorParameters<typeof UsageShardStore<Row>>[0]> = {}) {
  return new UsageShardStore<Row>({
    dir,
    fingerprint,
    now: () => NOW,
    encode: entries => entries,
    decode: value => Array.isArray(value) ? value as Row[] : null,
    ...overrides,
  })
}

async function shardFiles(dir: string): Promise<string[]> {
  const root = join(dir, 'usage-shards')
  const namespaces = await readdir(root)
  const names = await Promise.all(namespaces.map(async name => readdir(join(root, name))))
  return names.flat().filter(name => name.endsWith('.json'))
}

test('persists independently-sized atomic shards with owner-only permissions', async () => {
  await withDir(async dir => {
    const cache = store(dir)
    await cache.load(source('/logs/a.jsonl'), async () => [{ id: 'a', value: 1 }])
    await cache.load(source('/logs/b.jsonl'), async () => [{ id: 'b', value: 2 }])
    await cache.flush()

    assert.equal((await stat(dir)).mode & 0o777, 0o700)
    const root = join(dir, 'usage-shards')
    assert.equal((await stat(root)).mode & 0o777, 0o700)
    const namespace = (await readdir(root))[0]
    const files = await readdir(join(root, namespace))
    assert.equal(files.filter(name => name.endsWith('.json')).length, 2)
    for (const file of files.filter(name => name.endsWith('.json'))) {
      assert.equal((await stat(join(root, namespace, file))).mode & 0o777, 0o600)
    }
  })
})

test('does not duplicate concurrent parsing of the same source revision', async () => {
  await withDir(async dir => {
    const cache = store(dir)
    let parses = 0
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const parsingStarted = new Promise<void>(resolve => { started = resolve })
    const parse = async () => {
      parses++
      started()
      await gate
      return [{ id: 'one', value: 1 }]
    }
    const loads = Array.from({ length: 20 }, () => cache.load(source(), parse))
    await parsingStarted
    assert.equal(parses, 1)
    release()
    assert.deepEqual(await Promise.all(loads), Array.from({ length: 20 }, () => [{ id: 'one', value: 1 }]))
  })
})

test('source metadata changes replace only that shard', async () => {
  await withDir(async dir => {
    const cache = store(dir)
    let parses = 0
    const parse = async () => [{ id: `revision-${++parses}`, value: parses }]
    assert.deepEqual(await cache.load(source('/logs/changing.jsonl', NOW - 2, 10), parse), [{ id: 'revision-1', value: 1 }])
    assert.deepEqual(await cache.load(source('/logs/changing.jsonl', NOW - 1, 11), parse), [{ id: 'revision-2', value: 2 }])
    assert.equal(parses, 2)
    assert.equal((await shardFiles(dir)).length, 1)
  })
})

test('an older slow parse cannot overwrite a newer source revision', async () => {
  await withDir(async dir => {
    const cache = store(dir)
    let releaseOld!: () => void
    let oldStarted!: () => void
    const oldGate = new Promise<void>(resolve => { releaseOld = resolve })
    const started = new Promise<void>(resolve => { oldStarted = resolve })
    const oldLoad = cache.load(source('/logs/racing.jsonl', NOW - 2, 10), async () => {
      oldStarted()
      await oldGate
      return [{ id: 'old', value: 1 }]
    })
    await started
    assert.deepEqual(
      await cache.load(source('/logs/racing.jsonl', NOW - 1, 11), async () => [{ id: 'new', value: 2 }]),
      [{ id: 'new', value: 2 }],
    )
    releaseOld()
    assert.deepEqual(await oldLoad, [{ id: 'old', value: 1 }])

    const reloaded = store(dir)
    assert.deepEqual(
      await reloaded.load(source('/logs/racing.jsonl', NOW - 1, 11), async () => {
        throw new Error('newer disk shard was overwritten')
      }),
      [{ id: 'new', value: 2 }],
    )
  })
})

test('fingerprint changes invalidate parser and pricing shards without reading v8', async () => {
  await withDir(async dir => {
    // A legacy monolith is deliberately ignored, not loaded or rewritten.
    const v8 = join(dir, 'usage-v8.json')
    await writeFile(v8, JSON.stringify({ '/logs/session.jsonl': { rows: [['bad']] } }))

    const first = store(dir)
    assert.deepEqual(await first.load(source(), async () => [{ id: 'old', value: 1 }]), [{ id: 'old', value: 1 }])
    let parserCalls = 0
    const parserChanged = store(dir, { fingerprint: { ...fingerprint, parser: 'parser-2' } })
    assert.deepEqual(await parserChanged.load(source(), async () => {
      parserCalls++
      return [{ id: 'parser-new', value: 2 }]
    }), [{ id: 'parser-new', value: 2 }])
    assert.equal(parserCalls, 1)

    let pricingCalls = 0
    const pricingChanged = store(dir, { fingerprint: { ...fingerprint, pricing: 'prices-2' } })
    await pricingChanged.load(source(), async () => {
      pricingCalls++
      return [{ id: 'price-new', value: 3 }]
    })
    assert.equal(pricingCalls, 1)
    assert.equal((await stat(v8)).isFile(), true)
    assert.equal((await shardFiles(dir)).length, 3)
  })
})

test('bounds memory and prunes only completed stale shards', async () => {
  await withDir(async dir => {
    let now = 10_000
    const cache = store(dir, { maxMemoryShards: 1, maxMemoryBytes: 10_000, staleAfterMs: 10, now: () => now })
    await cache.load(source('/logs/old.jsonl', 1), async () => [{ id: 'old', value: 1 }])
    await cache.load(source('/logs/new.jsonl', 9_999), async () => [{ id: 'new', value: 2 }])
    assert.equal(cache.memoryStats().shards, 1)

    const namespace = join(dir, 'usage-shards', (await readdir(join(dir, 'usage-shards')))[0])
    const foreignTemp = join(namespace, `${'a'.repeat(64)}.json.999.live-writer.tmp`)
    await writeFile(foreignTemp, 'do not touch')
    await cache.prune(true)

    assert.equal((await readdir(namespace)).includes(foreignTemp.split('/').pop()!), true)
    assert.equal((await shardFiles(dir)).length, 1)
    now = 20_000
    await cache.prune(true)
    assert.equal((await shardFiles(dir)).length, 0)
  })
})

test('prunes stale completed shards in obsolete fingerprint namespaces only', async () => {
  await withDir(async dir => {
    const old = store(dir, {
      fingerprint: { ...fingerprint, parser: 'old-parser' },
      staleAfterMs: 1_000_000,
      now: () => 100,
    })
    await old.load(source('/logs/legacy.jsonl', 99), async () => [{ id: 'legacy', value: 1 }])

    const root = join(dir, 'usage-shards')
    const oldNamespace = join(root, (await readdir(root))[0])
    const foreignTemp = join(oldNamespace, `${'b'.repeat(64)}.json.999.live-writer.tmp`)
    await writeFile(foreignTemp, 'still owned elsewhere')

    const current = store(dir, {
      fingerprint: { ...fingerprint, parser: 'current-parser' },
      staleAfterMs: 10,
      now: () => 10_000,
    })
    await current.load(source('/logs/current.jsonl', 9_999), async () => [{ id: 'current', value: 2 }])
    await current.prune(true)

    assert.equal((await readdir(oldNamespace)).includes(foreignTemp.split('/').pop()!), true)
    assert.equal((await readdir(oldNamespace)).some(name => name.endsWith('.json')), false)
    assert.equal((await shardFiles(dir)).length, 1)
  })
})
