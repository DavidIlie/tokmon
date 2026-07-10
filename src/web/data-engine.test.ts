import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BILLING_STALE_MS,
  billingNeedsCatchUp,
  forEachProviderSequentially,
  throwIfRefreshFailures,
} from './data-engine'
import { createRefreshQueue, settleRefreshTasks } from './refresh-queue'

function deferred() {
  let resolve!: () => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve))

test('a new viewer catches up missing or stale quota data', () => {
  const accounts = [{ account: { id: 'codex' } }] as never
  assert.equal(billingNeedsCatchUp(accounts, new Map(), 1_000_000), true)
  assert.equal(billingNeedsCatchUp(
    accounts,
    new Map([['codex', 1_000_000 - DEFAULT_BILLING_STALE_MS + 1]]),
    1_000_000,
  ), false)
  assert.equal(billingNeedsCatchUp(
    accounts,
    new Map([['codex', 1_000_000 - DEFAULT_BILLING_STALE_MS]]),
    1_000_000,
  ), true)
  assert.equal(billingNeedsCatchUp(
    accounts,
    new Map([['codex', 1_000_000 - 2 * 60_000]]),
    1_000_000,
    5 * 60_000,
  ), false)
})

test('billing accounts run sequentially per provider while different providers overlap', async () => {
  const firstClaude = deferred()
  const codex = deferred()
  const started: string[] = []
  const accounts = [
    { account: { providerId: 'claude', id: 'claude-1' } },
    { account: { providerId: 'claude', id: 'claude-2' } },
    { account: { providerId: 'codex', id: 'codex-1' } },
  ]
  const task = forEachProviderSequentially(accounts, async value => {
    started.push(value.account.id)
    if (value.account.id === 'claude-1') await firstClaude.promise
    if (value.account.id === 'codex-1') await codex.promise
  })
  await turn()
  assert.deepEqual(started, ['claude-1', 'codex-1'])
  firstClaude.resolve()
  await turn()
  assert.deepEqual(started, ['claude-1', 'codex-1', 'claude-2'])
  codex.resolve()
  await task
})

test('forced refreshes coalesce behind a busy pass and await the queued pass', async () => {
  const gates = [deferred(), deferred()]
  let runs = 0
  const queue = createRefreshQueue(() => gates[runs++].promise)

  const first = queue.run(true)
  await turn()
  const forced = queue.run(true)
  const duplicate = queue.run(true)
  assert.equal(forced, duplicate)
  assert.equal(runs, 1)

  let settled = false
  void forced.then(() => { settled = true })
  gates[0].resolve()
  await turn()
  assert.equal(runs, 2)
  assert.equal(settled, false)

  gates[1].resolve()
  await Promise.all([first, forced, duplicate])
  assert.equal(settled, true)
})

test('rate-limited queues join forced requests to active work without a second pass', async () => {
  const gate = deferred()
  let runs = 0
  const queue = createRefreshQueue(async () => { runs++; await gate.promise }, undefined, {
    forceWhileActive: 'join',
  })
  const first = queue.run(true)
  await turn()
  const second = queue.run(true)
  assert.equal(second, first)
  assert.equal(runs, 1)
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(runs, 1)
})

test('a force arriving during the queued pass schedules one further pass', async () => {
  const gates = [deferred(), deferred(), deferred()]
  let runs = 0
  const queue = createRefreshQueue(() => gates[runs++].promise)

  const first = queue.run(true)
  await turn()
  const second = queue.run(true)
  gates[0].resolve()
  await turn()
  assert.equal(runs, 2)

  const third = queue.run(true)
  gates[1].resolve()
  await turn()
  assert.equal(runs, 3)

  gates[2].resolve()
  await Promise.all([first, second, third])
})

test('automatic refreshes join active work, respect idle skipping, and never queue', async () => {
  const gate = deferred()
  let runs = 0
  let idle = false
  const queue = createRefreshQueue(async () => { runs++; await gate.promise }, () => idle)

  const active = queue.run()
  await turn()
  assert.equal(queue.run(), active)
  gate.resolve()
  await active
  assert.equal(runs, 1)

  idle = true
  await queue.run()
  assert.equal(runs, 1)
  await queue.run(true)
  assert.equal(runs, 2)
})

test('a failed active pass still runs the queued force and stop drains waiters', async () => {
  const firstGate = deferred()
  let runs = 0
  const queue = createRefreshQueue(async () => {
    runs++
    if (runs === 1) {
      await firstGate.promise
      throw new Error('first pass failed')
    }
  })

  const first = queue.run(true)
  const firstFailure = assert.rejects(first, /first pass failed/)
  await turn()
  const queued = queue.run(true)
  firstGate.resolve()
  await Promise.all([firstFailure, queued])
  assert.equal(runs, 2)

  const stopGate = deferred()
  let stoppedRuns = 0
  const stoppedQueue = createRefreshQueue(() => { stoppedRuns++; return stopGate.promise })
  const active = stoppedQueue.run(true)
  await turn()
  const waiting = stoppedQueue.run(true)
  stoppedQueue.stop()
  await Promise.all([active, waiting])
  stopGate.resolve()
  await turn()
  assert.equal(stoppedRuns, 1)
})

test('refresh task settlement waits for every scope before propagating a failure', async () => {
  const slow = deferred()
  let settled = false
  const pending = settleRefreshTasks([
    Promise.reject(new Error('summary failed')),
    slow.promise,
  ]).finally(() => { settled = true })
  const rejection = assert.rejects(pending, /summary failed/)

  await turn()
  assert.equal(settled, false)
  slow.resolve()
  await rejection
  assert.equal(settled, true)
})

test('partial account failures become a manual-refresh error after results are applied', () => {
  assert.doesNotThrow(() => throwIfRefreshFailures('summary', []))
  assert.throws(
    () => throwIfRefreshFailures('summary', [new Error('account A failed'), new Error('account B failed')]),
    (cause: unknown) => {
      assert.ok(cause instanceof AggregateError)
      assert.equal(cause.errors.length, 2)
      assert.match(cause.message, /summary refresh failed for 2 accounts/)
      return true
    },
  )
})
