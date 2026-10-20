import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  SPARK_DAYS,
  dedupe,
  flushDisk,
  hasFileMatching,
  lastDayKeys,
  loadCachedEntries,
  summarize,
  tableSince,
  tabulate,
  type Entry,
} from './usage-core'
import { isClaudeSessionFile } from './claude/usage'
import { startOfDay, startOfMonth, startOfWeek } from '../tz'

// Build a fully populated Entry, overriding only the fields a test cares about.
// Every numeric field defaults to a distinct value so accidental cross-field
// bleed is visible.
function mk(over: Partial<Entry> & Pick<Entry, 'ts'>): Entry {
  return {
    model: 'm',
    cost: 0,
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
    cacheSavings: 0,
    ...over,
  }
}

test('table ingestion retains every available source row for all-time views', () => {
  assert.equal(tableSince('UTC'), 0)
})

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
      // Keep this persistence fixture inside the cache retention window. A
      // near-epoch mtime races the intentionally asynchronous stale-shard prune.
      [{ path: join(dir, 'source.jsonl'), mtimeMs: Date.now(), size: 1 }],
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

const NY = 'America/New_York'

test('summarize buckets a local-midnight entry into today/week/month with full token accounting', () => {
  const now = Date.now()
  // An entry at the exact NY local midnight of the current day is inside all
  // three windows, because week/month starts are never after the day start.
  const e = mk({ ts: startOfDay(now, NY), cost: 12, input: 1, output: 2, cacheCreate: 3, cacheRead: 4, cacheSavings: 5 })
  const { today, week, month, series, lastActivityAt } = summarize([e], NY)

  // tokens must be input + output + cacheCreate + cacheRead (not cacheSavings).
  assert.equal(today.tokens, 1 + 2 + 3 + 4)
  assert.equal(today.cost, 12)
  assert.equal(today.input, 1)
  assert.equal(today.cacheRead, 4)
  assert.equal(today.cacheSavings, 5)

  // The same entry aggregates identically in the wider windows.
  assert.deepEqual(week, today)
  assert.deepEqual(month, today)

  // The spark series is SPARK_DAYS long and today's cost lands in its last slot.
  assert.equal(series.length, SPARK_DAYS)
  assert.equal(series[SPARK_DAYS - 1], 12)
  assert.equal(lastActivityAt, e.ts)
})

test('summarize reports the newest real entry timestamp and null for no entries', () => {
  const older = mk({ ts: Date.parse('2026-07-09T10:00:00Z') })
  const newest = mk({ ts: Date.parse('2026-07-10T10:00:00Z') })
  assert.equal(summarize([newest, older], 'UTC').lastActivityAt, newest.ts)
  assert.equal(summarize([], 'UTC').lastActivityAt, null)
})

test('summarize excludes the instant before local midnight from today (non-UTC tz)', () => {
  const now = Date.now()
  const todayStart = startOfDay(now, NY)
  const inToday = mk({ ts: todayStart, cost: 10, input: 1, output: 2, cacheCreate: 3, cacheRead: 4 })
  // 23:59:59.999 of the previous NY day — one ms before the boundary.
  const beforeMidnight = mk({ ts: todayStart - 1, cost: 999, input: 100, output: 100, cacheCreate: 100, cacheRead: 100 })

  const { today } = summarize([beforeMidnight, inToday], NY)
  assert.equal(today.cost, 10)
  assert.equal(today.tokens, 1 + 2 + 3 + 4)
})

test('summarize week window rolls over at the Monday boundary', () => {
  const now = Date.now()
  const weekStart = startOfWeek(now, NY)
  const inWeek = mk({ ts: weekStart, cost: 7 })
  const beforeWeek = mk({ ts: weekStart - 1, cost: 500 })

  const { week } = summarize([beforeWeek, inWeek], NY)
  assert.equal(week.cost, 7)
})

test('summarize month window rolls over at the 1st-of-month boundary', () => {
  const now = Date.now()
  const monthStart = startOfMonth(now, NY)
  const inMonth = mk({ ts: monthStart, cost: 9 })
  const beforeMonth = mk({ ts: monthStart - 1, cost: 500 })

  const { month } = summarize([beforeMonth, inMonth], NY)
  assert.equal(month.cost, 9)
})

test('dedupe collapses duplicate ids keeping the last, and preserves first-seen order', () => {
  const out = dedupe([
    mk({ ts: 1000, id: 'a', cost: 1 }),
    mk({ ts: 2000, id: 'b', cost: 5 }),
    mk({ ts: 3000, id: 'a', cost: 9 }),
  ])
  // 'a' appears once (last write wins on value) and holds its first-seen slot.
  assert.equal(out.length, 2)
  assert.deepEqual(out.map(e => e.id), ['a', 'b'])
  assert.equal(out[0].cost, 9)
  assert.equal(out[0].ts, 3000)
  assert.equal(out[1].cost, 5)
})

test('dedupe keeps distinct ids and drops non-positive timestamps', () => {
  const out = dedupe([
    mk({ ts: 1000, id: 'x' }),
    mk({ ts: 2000, id: 'y' }),
    mk({ ts: 0, id: 'z' }),
    mk({ ts: -5, id: 'w' }),
    mk({ ts: Number.NaN, id: 'q' }),
  ])
  assert.deepEqual(out.map(e => e.id).sort(), ['x', 'y'])
})

test('dedupe collapses id-less entries only when every content field matches', () => {
  const base = { ts: 1000, model: 'm', input: 1, output: 2, cacheCreate: 3, cacheRead: 4, cost: 5 } as const
  const collapsed = dedupe([mk({ ...base, cacheSavings: 1 }), mk({ ...base, cacheSavings: 2 })])
  // cacheSavings is not part of the fallback key, so these collapse to one.
  assert.equal(collapsed.length, 1)

  const distinct = dedupe([mk({ ...base }), mk({ ...base, cost: 6 })])
  assert.equal(distinct.length, 2)
})

/** A wide tree whose only root-level file is the match, plus a deep miss tree. */
async function sessionTree(options: { rootMatch: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'tokmon-walk-'))
  if (options.rootMatch) await writeFile(join(root, 'session.jsonl'), '{}\n')
  let branch = root
  for (let depth = 0; depth < 12; depth++) {
    branch = join(branch, `level-${depth}`)
    await mkdir(branch, { recursive: true })
    for (let file = 0; file < 8; file++) {
      await writeFile(join(branch, `note-${file}.md`), 'x')
    }
  }
  await writeFile(join(branch, 'deepest.jsonl'), '{}\n')
  return { root, deepest: branch }
}

test('session detection does not follow symlinks back into the tree', async () => {
  const { root, deepest } = await sessionTree({ rootMatch: false })
  try {
    await symlink(root, join(deepest, 'loop'), 'dir')
    await symlink(join(deepest, 'deepest.jsonl'), join(root, 'linked.jsonl'), 'file')

    // A symlink is neither isFile() nor isDirectory(), so the loop cannot be
    // entered and the linked session file is not accepted as evidence.
    assert.equal(await hasFileMatching(root, name => name === 'linked.jsonl'), false)
    assert.equal(await hasFileMatching(root, isClaudeSessionFile), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
