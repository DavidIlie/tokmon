import test from 'node:test'
import assert from 'node:assert/strict'
import { dayKey } from '../../tz'
import { localDayTimestamp } from './usage'

for (const tz of ['Pacific/Kiritimati', 'America/Adak', 'UTC', 'Europe/Bucharest']) {
  test(`local Cursor day stays in ${tz}`, () => {
    const label = '2026-07-09'
    const ts = localDayTimestamp(label, tz)
    assert.notEqual(ts, null)
    assert.equal(dayKey(ts!, tz), label)
  })
}
