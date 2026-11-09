import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { opencodeTable } from './usage'

for (const tables of [['message'], ['session_message'], ['message', 'session_message']]) {
  test(`reads ${tables.join(' and ')} without counting migrated messages twice`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), 'tokmon-opencode-'))
    t.after(() => rm(home, { recursive: true, force: true }))
    const dir = join(home, '.local/share/opencode')
    await mkdir(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, 'opencode.db'))
    const ts = Date.now()
    for (const table of tables) {
      db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT${table === 'session_message' ? ', type TEXT, seq INTEGER' : ''})`)
      const insert = (id: string, input: number, cost: number, role = 'assistant', timestamp = ts) => {
        const data = { ...(table === 'message' ? { role, modelID: 'legacy-model' } : { model: { id: 'new-model' } }), cost, tokens: { input, output: 10, reasoning: 5, cache: { read: 20, write: 30 } } }
        if (table === 'message') db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(id, 'session', timestamp, JSON.stringify(data))
        else db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run(id, 'session', timestamp, JSON.stringify(data), role, input)
      }
      insert(table, 100, 1)
      insert('migrated', table === 'message' ? 999 : 200, table === 'message' ? 99 : 2)
      insert('user', 999, 99, 'user')
      insert('invalid-time', 999, 99, 'assistant', 0)
    }
    db.close()
    const result = await opencodeTable('UTC', home)
    assert.equal(result.daily.length, 1)
    const row = result.daily[0]
    const both = tables.length === 2
    const legacyOnly = tables[0] === 'message' && !both
    assert.equal(row.count, both ? 3 : 2)
    assert.equal(row.input, both ? 400 : legacyOnly ? 1099 : 300)
    assert.equal(row.cost, both ? 4 : legacyOnly ? 100 : 3)
    assert.equal(row.output, row.count * 10)
    assert.equal(row.cacheRead, row.count * 20)
    assert.equal(row.cacheCreate, row.count * 30)
    assert.equal(row.total, row.input + row.output + row.cacheRead + row.cacheCreate)
    assert.deepEqual(new Set(row.models), new Set(both ? ['legacy-model', 'new-model'] : [legacyOnly ? 'legacy-model' : 'new-model']))
  })
}

test('migration preserves a recorded cost when the new row omits it, including explicit zero costs', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tokmon-opencode-cost-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const dir = join(home, '.local/share/opencode')
  await mkdir(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'opencode.db'))
  db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, time_created INTEGER, data TEXT); CREATE TABLE session_message (id TEXT PRIMARY KEY, time_created INTEGER, type TEXT, data TEXT)')
  const ts = Date.now()
  for (const [id, cost] of [['omitted', undefined], ['free', 0]] as const) {
    const tokens = { input: 10, output: 20, cache: { read: 0, write: 0 } }
    db.prepare('INSERT INTO message VALUES (?, ?, ?)').run(id, ts, JSON.stringify({ role: 'assistant', modelID: 'legacy', tokens, cost: 7 }))
    db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?)').run(id, ts, 'assistant', JSON.stringify({ model: { id: 'modern' }, tokens, cost }))
  }
  db.close()
  const table = await opencodeTable('UTC', home)
  assert.equal(table.daily[0].count, 2)
  assert.equal(table.daily[0].cost, 7)
  assert.deepEqual(table.daily[0].models, ['modern'])
})
