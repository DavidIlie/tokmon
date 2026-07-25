import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldSeedLocalStats } from './use-degraded-polling'

const ready = {
  degraded: true, configReady: true, showPicker: false, accountCount: 2,
}

test('the cached snapshot seeds the first degraded epoch', () => {
  assert.equal(shouldSeedLocalStats({ ...ready, seededEpoch: null, epoch: 0 }), true)
})

test('an epoch already seeded is not seeded twice', () => {
  assert.equal(shouldSeedLocalStats({ ...ready, seededEpoch: 0, epoch: 0 }), false)
})

// The collector epoch advances — clearing every collected stat — whenever the
// account set, the timezone or the degraded flag changes. Losing the daemon a
// second time therefore lands on an empty dashboard unless seeding re-arms.
test('losing the daemon again re-arms seeding for the new epoch', () => {
  assert.equal(shouldSeedLocalStats({ ...ready, seededEpoch: 0, epoch: 1 }), true)
})

test('adding an account while offline re-arms seeding for the new epoch', () => {
  assert.equal(shouldSeedLocalStats({ ...ready, seededEpoch: 3, epoch: 4 }), true)
})

test('seeding stays off while connected, unconfigured, picking, or accountless', () => {
  const fresh = { seededEpoch: null, epoch: 1 }
  assert.equal(shouldSeedLocalStats({ ...ready, ...fresh, degraded: false }), false)
  assert.equal(shouldSeedLocalStats({ ...ready, ...fresh, configReady: false }), false)
  assert.equal(shouldSeedLocalStats({ ...ready, ...fresh, showPicker: true }), false)
  assert.equal(shouldSeedLocalStats({ ...ready, ...fresh, accountCount: 0 }), false)
})
