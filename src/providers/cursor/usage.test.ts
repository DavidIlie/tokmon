import test from 'node:test'
import assert from 'node:assert/strict'
import { dayKey } from '../../tz'
import { localDayTimestamp, overlayEntries, type LocalDayEntry } from './usage'
import type { Entry } from '../usage-core'

for (const tz of ['Pacific/Kiritimati', 'America/Adak', 'UTC', 'Europe/Bucharest']) {
  test(`local Cursor day stays in ${tz}`, () => {
    const label = '2026-07-09'
    const ts = localDayTimestamp(label, tz)
    assert.notEqual(ts, null)
    assert.equal(dayKey(ts!, tz), label)
  })
}

// --- overlayEntries: API-authoritative window vs local composer rows ---

const TZ = 'UTC'

function apiEntry(day: string, cost: number): Entry {
  const ts = localDayTimestamp(day, TZ)
  assert.notEqual(ts, null)
  return { ts: ts!, model: 'gpt', cost, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, count: 1 }
}

function localEntry(day: string, cost: number): LocalDayEntry {
  const ts = localDayTimestamp(day, TZ)
  assert.notEqual(ts, null)
  return { day, entry: { ts: ts!, model: 'gpt', cost, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cacheSavings: 0, count: 1 } }
}

const sumCost = (es: Entry[]): number => es.reduce((a, e) => a + e.cost, 0)

test('overlay: conversation created on a quiet day but billed later in-window is not double counted', () => {
  // API window spans 2026-07-01 .. 2026-07-10; the conversation was created on the
  // quiet day 2026-07-05 (no API event) but its $5 was billed by the API on 07-10.
  const api = [apiEntry('2026-07-01', 1), apiEntry('2026-07-10', 5)]
  const local = [localEntry('2026-07-05', 5)]
  const out = overlayEntries(api, local, TZ)
  // Local 07-05 row is inside the window -> dropped; only the two API rows survive.
  assert.equal(out.length, 2)
  assert.equal(sumCost(out), 6)
})

test('overlay: api.length === 0 falls back to local rows unchanged', () => {
  const local = [localEntry('2026-07-05', 5), localEntry('2026-07-06', 3)]
  const out = overlayEntries([], local, TZ)
  assert.equal(out.length, 2)
  assert.equal(sumCost(out), 8)
  assert.deepEqual(out, local.map(l => l.entry))
})

test('overlay: local days entirely outside the API window still contribute', () => {
  // API only covers 2026-07-05.
  const api = [apiEntry('2026-07-05', 3)]
  const local = [
    localEntry('2026-07-01', 2), // before window -> contributes (older history)
    localEntry('2026-07-05', 9), // inside window -> dropped (API authoritative)
    localEntry('2026-07-10', 4), // after window -> contributes (API not caught up)
  ]
  const out = overlayEntries(api, local, TZ)
  assert.equal(out.length, 3) // 1 API + 2 outside-window local
  assert.equal(sumCost(out), 3 + 2 + 4)
  // The in-window local row's $9 must not appear.
  assert.ok(!out.some(e => e.cost === 9))
})
