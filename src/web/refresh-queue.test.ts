import assert from 'node:assert/strict'
import test from 'node:test'
import { createRefreshQueue, settleRefreshTasks } from './refresh-queue'

const turn = () => new Promise<void>(resolve => setImmediate(resolve))
const settle = async () => { for (let i = 0; i < 8; i++) await turn() }

/**
 * Models the four loops createDataEngine builds, with the exact per-loop
 * options it passes, so the pass arithmetic behind a user-initiated refresh is
 * asserted against the real queue. `passes` counts complete runs of each body.
 */
function engineLoops() {
  const passes = { summary: 0, history: 0, billing: 0, peak: 0 }
  const loop = (scope: keyof typeof passes, options?: { forceWhileActive: 'join' }) =>
    createRefreshQueue(async () => { passes[scope]++; await turn() }, () => false, options)
  return {
    passes,
    summary: loop('summary'),
    history: loop('history'),
    // data-engine gives billing (and only billing) forceWhileActive: 'join'.
    billing: loop('billing', { forceWhileActive: 'join' }),
    peak: loop('peak'),
  }
}

const forceAll = (loops: ReturnType<typeof engineLoops>): Promise<void>[] => [
  loops.summary.run(true),
  loops.history.run(true),
  loops.billing.run(true),
  loops.peak.run(true),
]

test('an explicit refresh alone runs every loop exactly once', async () => {
  const loops = engineLoops()

  // What rediscovery + engine.refresh('all') costs once the reconfiguration is
  // silent: the refresh is the only forced pass any queue sees.
  await settleRefreshTasks(forceAll(loops))
  await settle()

  assert.deepEqual(loops.passes, { summary: 1, history: 1, billing: 1, peak: 1 })
})

test('a reconfiguration that starts its own fetches doubles every loop but joined billing', async () => {
  const loops = engineLoops()

  // The regression shape: setConfig forces each queue, then engine.refresh
  // forces the same queues while the first pass is still active, and a forced
  // call during active work queues a second full pass instead of joining.
  for (const task of forceAll(loops)) void task
  await settleRefreshTasks(forceAll(loops))
  await settle()

  // Only billing's 'join' option escaped it — which is why the fix is a
  // behavior split rather than adding 'join' to the other three loops.
  assert.deepEqual(loops.passes, { summary: 2, history: 2, billing: 1, peak: 2 })
})

test('one explicit refresh makes exactly one external peak-status request', async () => {
  // Stands in for fetchPeak's fetch('https://promoclock.co/api/status'), the
  // third-party endpoint the doubled pass was hitting twice per Refresh.
  const peakQueue = () => {
    let requests = 0
    const queue = createRefreshQueue(async () => { requests++; await turn() }, () => false)
    return { queue, requests: () => requests }
  }

  const split = peakQueue()
  await settleRefreshTasks([split.queue.run(true)])
  await settle()
  assert.equal(split.requests(), 1)

  const doubled = peakQueue()
  void doubled.queue.run(true)
  await settleRefreshTasks([doubled.queue.run(true)])
  await settle()
  assert.equal(doubled.requests(), 2)
})
