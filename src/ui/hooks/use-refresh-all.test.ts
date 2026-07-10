import assert from 'node:assert/strict'
import test from 'node:test'
import { awaitRefreshCompletion } from './use-refresh-all'

test('awaitRefreshCompletion resolves only when the refresh request completes', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let settled = false
  const pending = awaitRefreshCompletion(() => gate, 100)
    .then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 8))
  assert.equal(settled, false)
  release()
  await pending
  assert.equal(settled, true)
})

test('awaitRefreshCompletion forwards transport failures', async () => {
  await assert.rejects(
    awaitRefreshCompletion(() => Promise.reject(new Error('daemon rejected refresh')), 100),
    /daemon rejected refresh/,
  )
})

test('awaitRefreshCompletion times out without claiming the daemon work was cancelled', async () => {
  // Production intentionally unrefs the timeout so it cannot keep the CLI alive.
  // Keep this test process alive independently until that timeout is observed.
  const keepAlive = setTimeout(() => {}, 100)
  try {
    await assert.rejects(
      awaitRefreshCompletion(() => new Promise<void>(() => {}), 8),
      /still running after .* may finish in the background/,
    )
  } finally {
    clearTimeout(keepAlive)
  }
})
