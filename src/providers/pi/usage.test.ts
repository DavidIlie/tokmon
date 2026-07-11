import test from 'node:test'
import assert from 'node:assert/strict'
import { recordToEntry } from './usage'

const TS = '2026-07-11T00:00:00.000Z'
const TS_MS = Date.parse(TS)

test('pi maps usage fields and trusts logged total cost', () => {
  const entry = recordToEntry({
    type: 'message',
    timestamp: TS,
    message: {
      role: 'assistant',
      responseModel: 'claude-opus',
      usage: {
        input: 100,
        output: 250,
        cacheRead: 40,
        cacheWrite: 10,
        cost: { total: 0.99, input: 0.0003, cacheRead: 0.00001 },
      },
    },
  })
  assert.ok(entry)
  assert.equal(entry.ts, TS_MS)
  assert.equal(entry.model, 'claude-opus')
  assert.equal(entry.input, 100)
  assert.equal(entry.output, 250)
  assert.equal(entry.cacheRead, 40)
  assert.equal(entry.cacheCreate, 10)
  // cost is trusted directly from the log, not recomputed
  assert.equal(entry.cost, 0.99)
})

test('pi derives cacheSavings from the input rate applied to cached reads', () => {
  // inputRate = costInput/input = 1.0/100 = 0.01 per token
  // expected read cost = cacheRead * rate = 50 * 0.01 = 0.5
  // actual charged cacheRead cost = 0.1 -> savings = 0.4
  const entry = recordToEntry({
    type: 'message',
    timestamp: TS,
    message: {
      role: 'assistant',
      model: 'm',
      usage: {
        input: 100,
        output: 0,
        cacheRead: 50,
        cost: { total: 0, input: 1.0, cacheRead: 0.1 },
      },
    },
  })
  assert.ok(entry)
  assert.ok(Math.abs(entry.cacheSavings - 0.4) < 1e-9)
})

test('pi floors cacheSavings at zero when charged more than the input rate', () => {
  const entry = recordToEntry({
    type: 'message',
    timestamp: TS,
    message: {
      role: 'assistant',
      model: 'm',
      usage: { input: 100, cacheRead: 50, cost: { input: 1.0, cacheRead: 5.0 } },
    },
  })
  assert.ok(entry)
  assert.equal(entry.cacheSavings, 0)
})

test('pi has no cacheSavings without both input and cached reads', () => {
  const noRead = recordToEntry({
    type: 'message', timestamp: TS,
    message: { role: 'assistant', model: 'm', usage: { input: 100, cost: { input: 1 } } },
  })
  assert.ok(noRead)
  assert.equal(noRead.cacheSavings, 0)
})

test('pi model precedence: responseModel over model over unknown', () => {
  const both = recordToEntry({
    type: 'message', timestamp: TS,
    message: { role: 'assistant', responseModel: 'resp', model: 'plain', usage: { input: 1 } },
  })
  assert.equal(both?.model, 'resp')

  const onlyModel = recordToEntry({
    type: 'message', timestamp: TS,
    message: { role: 'assistant', model: 'plain', usage: { input: 1 } },
  })
  assert.equal(onlyModel?.model, 'plain')

  const neither = recordToEntry({
    type: 'message', timestamp: TS,
    message: { role: 'assistant', usage: { input: 1 } },
  })
  assert.equal(neither?.model, 'unknown')
})

test('pi rejects non-usage / empty / non-assistant records', () => {
  assert.equal(recordToEntry({ type: 'other', message: {} }), null)
  assert.equal(recordToEntry({ type: 'message', message: { role: 'user', usage: { input: 1 } } }), null)
  assert.equal(recordToEntry({ type: 'message', message: { role: 'assistant' } }), null)
  // all tokens zero -> dropped
  assert.equal(recordToEntry({
    type: 'message', timestamp: TS,
    message: { role: 'assistant', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  }), null)
  // no valid timestamp -> dropped
  assert.equal(recordToEntry({
    type: 'message',
    message: { role: 'assistant', usage: { input: 5 } },
  }), null)
})
