import assert from 'node:assert/strict'
import test from 'node:test'
import { parseQueryArgs, queryHelp, runQueryCommand } from './cli-command'
import type { WebSnapshot } from './web/contract'

test('query argument parser accepts agent filters and rejects ambiguous refresh modes', () => {
  assert.deepEqual(
    parseQueryArgs(['--period=week', '--provider', 'codex', '--model', 'terra', '--json', '--timeout', '12']),
    {
      help: false,
      json: true,
      compact: false,
      refresh: false,
      cached: false,
      timeoutMs: 12_000,
      period: 'week',
      provider: 'codex',
      model: 'terra',
      positionals: [],
    },
  )
  assert.throws(() => parseQueryArgs(['--provider', 'unknown']), /unknown provider/)
  assert.throws(() => parseQueryArgs(['--refresh', '--cached']), /cannot be used together/)
})

test('every query command has focused help without starting the daemon', async () => {
  assert.match(queryHelp('usage'), /tokmon usage --model opus --json/)
  assert.match(queryHelp('providers'), /local data\/config locations/)
  assert.match(queryHelp('snapshot'), /complete raw snapshot/)
  assert.match(await runQueryCommand('config', ['--json', '--compact']), /^\{"path":".+config\.json"\}\n$/)
})

test('usage command emits a stable JSON envelope through an injected snapshot seam', async () => {
  const snapshot: WebSnapshot = {
    version: 'test', generatedAt: Date.UTC(2026, 6, 10), tz: 'UTC',
    intervalMs: 8_000, billingIntervalMs: 300_000, providers: [], accounts: [],
    seeded: false, peak: null,
  }
  let refresh: string | null = null
  const output = await runQueryCommand('usage', ['--json', '--compact', '--cached'], {
    fetchSnapshot: async (_timeout, requestedRefresh) => { refresh = requestedRefresh; return snapshot },
    configPath: () => '/tmp/tokmon-config.json',
  })
  const parsed = JSON.parse(output)
  assert.equal(refresh, null)
  assert.equal(parsed.schemaVersion, 1)
  assert.equal(parsed.tokmonConfig, '/tmp/tokmon-config.json')
  assert.deepEqual(parsed.filters, { provider: null, account: null, model: null })
  assert.deepEqual(parsed.models, [])
})
