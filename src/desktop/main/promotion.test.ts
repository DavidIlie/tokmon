import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_TRAY_CONFIG } from '../../config-schema'
import {
  selectPromotedAccounts,
  type PromotionAccount,
  type PromotionState,
} from './promotion'

const NOW = Date.parse('2026-07-13T12:00:00Z')
const MINUTE = 60_000
const NONE: PromotionState = { primaryId: null, promotedAt: null }
const config = {
  activeTimeoutMin: DEFAULT_TRAY_CONFIG.activeTimeoutMin,
  graceMin: DEFAULT_TRAY_CONFIG.graceMin,
  promotionHoldMin: DEFAULT_TRAY_CONFIG.promotionHoldMin,
  pinnedAccount: null,
}

function account(id: string, activityMinAgo: number | null, remainingPct: number | null, resetsInMin = 60): PromotionAccount {
  return {
    id,
    lastActivityAt: activityMinAgo === null ? null : NOW - activityMinAgo * MINUTE,
    remainingPct,
    resetsAt: NOW + resetsInMin * MINUTE,
  }
}

test('an empty account set clears promotion state', () => {
  assert.deepEqual(
    selectPromotedAccounts([], { primaryId: 'gone', promotedAt: NOW - MINUTE }, config, NOW),
    { slots: [], overflow: [], state: { primaryId: null, promotedAt: null } },
  )
})

test('startup selects the most recent account inside grace, even when it is no longer hot', () => {
  const result = selectPromotedAccounts([
    account('older', 25, 2),
    account('newer', 15, 90),
  ], NONE, config, NOW)
  assert.deepEqual(result.slots, ['newer', 'older'])
})

test('with no activity in grace, fallback is remaining percent, reset, then account ID', () => {
  const result = selectPromotedAccounts([
    account('z', 31, 20, 15),
    account('b', null, 10, 30),
    account('a', null, 10, 30),
    account('later-reset', null, 10, 90),
  ], NONE, config, NOW)
  assert.deepEqual(result.slots, ['a', 'b'])
  assert.deepEqual(result.overflow, ['later-reset', 'z'])
})

test('hot and grace boundaries are inclusive', () => {
  const hotBoundary = account('hot-boundary', 10, 80)
  const graceBoundary = account('grace-boundary', 30, 5)
  const result = selectPromotedAccounts([graceBoundary, hotBoundary], NONE, config, NOW)
  assert.deepEqual(result.slots, ['hot-boundary', 'grace-boundary'])
})

test('an incumbent remains primary throughout grace while a newer hot account becomes secondary', () => {
  const result = selectPromotedAccounts([
    account('incumbent', 20, 80),
    account('challenger', 1, 50),
  ], { primaryId: 'incumbent', promotedAt: NOW - 20 * MINUTE }, config, NOW)
  assert.deepEqual(result.slots, ['incumbent', 'challenger'])
  assert.deepEqual(result.state, { primaryId: 'incumbent', promotedAt: NOW - 20 * MINUTE })
})

test('a strictly newer challenger displaces an incumbent past grace after the hold', () => {
  const result = selectPromotedAccounts([
    account('incumbent', 31, 5),
    account('challenger', 1, 50),
  ], { primaryId: 'incumbent', promotedAt: NOW - 5 * MINUTE }, config, NOW)
  assert.equal(result.state.primaryId, 'challenger')
  assert.equal(result.state.promotedAt, NOW)
})

test('the five-minute hold blocks an ordinary challenger', () => {
  const result = selectPromotedAccounts([
    account('incumbent', 31, 80),
    account('challenger', 1, 50),
  ], { primaryId: 'incumbent', promotedAt: NOW - 5 * MINUTE + 1 }, config, NOW)
  assert.deepEqual(result.slots, ['incumbent', 'challenger'])
})

test('a hot challenger at ten percent remaining bypasses grace and hold', () => {
  const result = selectPromotedAccounts([
    account('incumbent', 1, 90),
    account('challenger', 2, 10),
  ], { primaryId: 'incumbent', promotedAt: NOW - MINUTE }, config, NOW)
  assert.deepEqual(result.slots, ['challenger', 'incumbent'])
  assert.deepEqual(result.state, { primaryId: 'challenger', promotedAt: NOW })
})

test('an eleven-percent challenger does not bypass an incumbent in grace', () => {
  const result = selectPromotedAccounts([
    account('incumbent', 9, 90),
    account('challenger', 1, 11),
  ], { primaryId: 'incumbent', promotedAt: NOW - 20 * MINUTE }, config, NOW)
  assert.equal(result.state.primaryId, 'incumbent')
})

test('equal activity timestamps do not satisfy the strictly-newer displacement rule', () => {
  const result = selectPromotedAccounts([
    account('incumbent', 31, 80),
    account('challenger', 31, 90),
  ], { primaryId: 'incumbent', promotedAt: NOW - 10 * MINUTE }, { ...config, activeTimeoutMin: 40 }, NOW)
  assert.equal(result.state.primaryId, 'incumbent')
})

test('a valid pin always owns primary while the newest hot account is secondary', () => {
  const result = selectPromotedAccounts([
    account('pinned', null, 90),
    account('active', 1, 80),
    account('other', 2, 5),
  ], { primaryId: 'active', promotedAt: NOW - MINUTE }, { ...config, pinnedAccount: 'pinned' }, NOW)
  assert.deepEqual(result.slots, ['pinned', 'active'])
})

test('an unknown pin is ignored', () => {
  const result = selectPromotedAccounts([
    account('active', 1, 80),
    account('fallback', null, 5),
  ], NONE, { ...config, pinnedAccount: 'missing' }, NOW)
  assert.deepEqual(result.slots, ['active', 'fallback'])
})

test('overflow is hot-first by recency, then remaining/reset/id', () => {
  const result = selectPromotedAccounts([
    account('primary', 1, 90),
    account('secondary', 2, 80),
    account('hot-b', 3, 70),
    account('hot-a', 3, 60),
    account('cold-z', null, 20, 10),
    account('cold-b', null, 10, 20),
    account('cold-a', null, 10, 20),
  ], { primaryId: 'primary', promotedAt: NOW - 10 * MINUTE }, config, NOW)
  assert.deepEqual(result.slots, ['primary', 'secondary'])
  assert.deepEqual(result.overflow, ['hot-a', 'hot-b', 'cold-a', 'cold-b', 'cold-z'])
})

test('selection is pure and never mutates account ordering', () => {
  const accounts = [account('b', 2, 20), account('a', 1, 10)]
  const before = structuredClone(accounts)
  selectPromotedAccounts(accounts, NONE, config, NOW)
  assert.deepEqual(accounts, before)
})
