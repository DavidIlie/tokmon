import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account } from '../types'
import { copilotBilling } from './billing'

const account = (homeDir: string): Account => ({
  id: 'copilot',
  providerId: 'copilot',
  name: 'Copilot',
  color: '#fff',
  homeDir,
})

// Drive copilotBilling end-to-end (no source edits): a real gh hosts.yml
// provides the token, and a stubbed global fetch returns a canned usage
// payload so we exercise the quota math (the inversion-prone used-vs-remaining
// percent paths and the limited-user count fallback).
async function billWith(usage: unknown, status = 200): Promise<Awaited<ReturnType<typeof copilotBilling>>> {
  const home = await mkdtemp(join(tmpdir(), 'tokmon-copilot-'))
  const ghDir = join(home, '.config', 'gh')
  await mkdir(ghDir, { recursive: true })
  await writeFile(join(ghDir, 'hosts.yml'), 'github.com:\n    oauth_token: gho_0123456789abcdefghijklmnop\n')

  const realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(status === 200 ? JSON.stringify(usage) : '', {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

  try {
    return await copilotBilling(account(home))
  } finally {
    globalThis.fetch = realFetch
    await rm(home, { recursive: true, force: true })
  }
}

test('copilot percent_remaining becomes used percent (Credits, primary)', async () => {
  const result = await billWith({
    copilot_plan: 'copilot_pro',
    quota_snapshots: { premium_interactions: { percent_remaining: 30 } },
  })
  assert.equal(result.error, null)
  assert.equal(result.plan, 'copilot_pro')
  const credits = result.metrics.find(m => m.label === 'Credits')
  assert.ok(credits)
  assert.equal(credits.used, 70)
  assert.equal(credits.limit, 100)
  assert.equal(credits.format.kind, 'percent')
  assert.equal(credits.primary, true)
})

test('copilot derives used from entitlement and remaining when no percent given', async () => {
  // 50 remaining of 200 entitlement => 75% used, not 25%.
  const result = await billWith({
    quota_snapshots: { chat: { entitlement: 200, remaining: 50 } },
  })
  const chat = result.metrics.find(m => m.label === 'Chat')
  assert.ok(chat)
  assert.equal(chat.used, 75)
  assert.equal(chat.limit, 100)
})

test('copilot clamps a computed percent into 0..100', async () => {
  const result = await billWith({
    quota_snapshots: { premium_interactions: { percent_remaining: 130 } },
  })
  const credits = result.metrics.find(m => m.label === 'Credits')
  assert.ok(credits)
  assert.equal(credits.used, 0)
})

test('copilot omits unlimited and sentinel quota snapshots', async () => {
  const result = await billWith({
    quota_snapshots: {
      premium_interactions: { unlimited: true, percent_remaining: 40 },
      chat: { entitlement: -1, remaining: 5 },
      completions: { entitlement: 0, remaining: 0 },
    },
    token_based_billing: true,
  })
  assert.deepEqual(result.metrics, [])
  // token_based_billing => empty metrics is expected, not an error.
  assert.equal(result.error, null)
})

test('copilot surfaces permitted overage as an unbounded Extra metric', async () => {
  const result = await billWith({
    quota_snapshots: {
      premium_interactions: { percent_remaining: 10, overage_permitted: true, overage_count: 3 },
    },
  })
  const credits = result.metrics.find(m => m.label === 'Credits')
  assert.ok(credits)
  assert.equal(credits.used, 90)
  const extra = result.metrics.find(m => m.label === 'Extra')
  assert.ok(extra)
  assert.equal(extra.used, 3)
  assert.equal(extra.limit, null)
  assert.equal(extra.format.kind, 'count')
})

test('copilot falls back to limited-user counts when snapshots are absent', async () => {
  // remaining=limited_user_quotas, total=monthly_quotas => used = total-remaining.
  const result = await billWith({
    limited_user_quotas: { chat: 20, completions: 10 },
    monthly_quotas: { chat: 50, completions: 40 },
  })
  const chat = result.metrics.find(m => m.label === 'Chat')
  assert.ok(chat)
  assert.equal(chat.used, 30)
  assert.equal(chat.limit, 50)
  assert.equal(chat.format.kind, 'count')
  const completions = result.metrics.find(m => m.label === 'Completions')
  assert.ok(completions)
  assert.equal(completions.used, 30)
  assert.equal(completions.limit, 40)
})

test('copilot reports an auth error on a 401 response', async () => {
  const result = await billWith({}, 401)
  assert.deepEqual(result.metrics, [])
  assert.match(result.error ?? '', /Token invalid/)
})
