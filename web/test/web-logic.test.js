import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanUnavailableFilters } from '../src/lib/filter-cleanup.ts'
import { DAY, parseDay, weekStartStr } from '../src/lib/date.ts'
import { shareFilename } from '../src/lib/share-filename.ts'

test('day parsing is UTC-stable across a week boundary', () => {
  assert.equal(parseDay('2026-07-09') - parseDay('2026-07-08'), DAY)
  assert.equal(weekStartStr('2026-07-09'), '2026-07-06')
  assert.equal(weekStartStr('2026-07-12'), '2026-07-06')
})

test('share filenames are deterministic and filesystem-safe', () => {
  const date = new Date(2026, 0, 2, 3, 4)
  assert.equal(shareFilename('Model / GPT 5.6', date), 'tokmon-model-gpt-5.6-20260102-0304.png')
  assert.equal(shareFilename('***', date), 'tokmon-export-20260102-0304.png')
})

test('filter cleanup drops stale values but preserves models until model data is ready', () => {
  const filters = { providers: ['claude', 'missing'], models: ['gpt-5', 'pending'], account: 'gone', period: '30d' }
  const loading = cleanUnavailableFilters(filters, {
    providers: new Set(['claude']),
    accounts: new Set(['work']),
    models: new Set(),
    modelsReady: false,
  })
  assert.deepEqual(loading, { providers: ['claude'], models: ['gpt-5', 'pending'], account: 'all', period: '30d' })

  const ready = cleanUnavailableFilters(loading, {
    providers: new Set(['claude']),
    accounts: new Set(['work']),
    models: new Set(['gpt-5']),
    modelsReady: true,
  })
  assert.deepEqual(ready.models, ['gpt-5'])
})
