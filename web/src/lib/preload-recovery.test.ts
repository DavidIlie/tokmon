import assert from 'node:assert/strict'
import test from 'node:test'
import { PRELOAD_RELOAD_COOLDOWN_MS, shouldReloadForPreloadFailure } from './preload-recovery'

test('missing upgrade chunks trigger one bounded reload instead of a loop', () => {
  assert.equal(shouldReloadForPreloadFailure(Number.NaN, 1_000), true)
  assert.equal(shouldReloadForPreloadFailure(1_000, 1_001), false)
  assert.equal(shouldReloadForPreloadFailure(1_000, 1_000 + PRELOAD_RELOAD_COOLDOWN_MS), true)
})
