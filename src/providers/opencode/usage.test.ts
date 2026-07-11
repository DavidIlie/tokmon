import test from 'node:test'
import assert from 'node:assert/strict'
import { rowToEntry } from './usage'

// opencode's tokens.output already includes reasoning tokens, so the parser
// must report Entry.output as the raw tokens.output value without adding
// reasoning back in (which would inflate output and total).
test('opencode output equals raw tokens.output even when reasoning is present', () => {
  const entry = rowToEntry({
    ts: 1_700_000_000_000,
    model: 'anthropic/claude-opus',
    cost: 0.42,
    input: 100,
    output: 250,
    reasoning: 180, // present in the DB row but must be ignored
    cacheRead: 20,
    cacheWrite: 10,
  })
  assert.ok(entry)
  assert.equal(entry.output, 250)
  assert.equal(entry.input, 100)
  assert.equal(entry.cacheRead, 20)
  assert.equal(entry.cacheCreate, 10)
  // total tokens must exclude reasoning
  assert.equal(entry.input + entry.output + entry.cacheRead + entry.cacheCreate, 380)
})

test('opencode maps fields and trusts row cost', () => {
  const entry = rowToEntry({
    ts: 1_700_000_000_000,
    model: 'openai/gpt-5',
    cost: 1.23,
    input: 5,
    output: 7,
    cacheRead: 0,
    cacheWrite: 0,
  })
  assert.ok(entry)
  assert.equal(entry.model, 'openai/gpt-5')
  assert.equal(entry.cost, 1.23)
  assert.equal(entry.cacheSavings, 0)
})

test('opencode falls back to unknown model and drops empty/timeless rows', () => {
  const unknownModel = rowToEntry({ ts: 1_700_000_000_000, input: 1 })
  assert.ok(unknownModel)
  assert.equal(unknownModel.model, 'unknown')

  // no timestamp -> dropped
  assert.equal(rowToEntry({ model: 'm', input: 5 }), null)
  // all token fields zero -> dropped
  assert.equal(rowToEntry({ ts: 1_700_000_000_000, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), null)
})
