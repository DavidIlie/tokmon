import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { grokModelMapFingerprint, parseUnifiedLog } from './usage'

const FIXTURE_LOG = fileURLToPath(new URL('./__fixtures__/home/.grok/logs/unified.jsonl', import.meta.url))
const SESSION_C = '019f478c-0985-7b60-84cc-791642c8f933' // absent from summary.json
const SESSION_D = '019f478d-6468-72e3-bf26-4298447f5eda' // summary.json current_model_id = grok-4.5

const turnsFor = (entries: { id?: string; ts: number; model: string; cost: number }[], sid: string) =>
  entries.filter((e) => (e.id ?? '').startsWith(`${sid}#`)).sort((a, b) => a.ts - b.ts)

test('Grok usage cache fingerprint tracks model-map content with stable ordering', () => {
  const first = new Map([
    ['/grok-b/logs/unified.jsonl', new Map([['session-2', 'grok-4.5']])],
    ['/grok-a/logs/unified.jsonl', new Map([
      ['session-1', 'grok-build-0.1'],
      ['session-3', 'grok-code-fast-1'],
    ])],
  ])
  const reordered = new Map([
    ['/grok-a/logs/unified.jsonl', new Map([
      ['session-3', 'grok-code-fast-1'],
      ['session-1', 'grok-build-0.1'],
    ])],
    ['/grok-b/logs/unified.jsonl', new Map([['session-2', 'grok-4.5']])],
  ])
  const changed = new Map(reordered)
  changed.set('/grok-b/logs/unified.jsonl', new Map([['session-2', 'grok-4.20']]))

  assert.equal(grokModelMapFingerprint(first), grokModelMapFingerprint(reordered))
  assert.notEqual(grokModelMapFingerprint(first), grokModelMapFingerprint(changed))
  assert.match(grokModelMapFingerprint(first), /^[a-f0-9]{24}$/)
})

test('mid-session model switch prices each turn at the model active at that turn', async () => {
  // summary.json only records the FINAL model (grok-4.5). Blindly using it would
  // misprice the pre-switch turn; attribution must follow the "model changed" events.
  const entries = await parseUnifiedLog(FIXTURE_LOG, new Map([[SESSION_D, 'grok-4.5']]))
  const turns = turnsFor(entries, SESSION_D)
  assert.equal(turns.length, 2, 'session D should have two inference_done turns')
  // First turn precedes the switch to grok-4.5 (log switched to grok-code-fast-1 before it).
  assert.equal(turns[0].model, 'grok-code-fast-1')
  // Second turn follows the "model changed" -> grok-4.5 event.
  assert.equal(turns[1].model, 'grok-4.5')
  // Distinct pricing tiers => distinct costs prove the attribution feeds pricing.
  assert.ok(turns[0].cost > 0 && turns[1].cost > 0)
})

test('session absent from summary.json uses the log-derived model, not the blind default', async () => {
  // Empty summary map: session C is not present, and its turn would otherwise
  // fall back to the grok-4.5 default. The log records a switch to grok-code-fast-1
  // before its turn, so that is what must be used.
  const entries = await parseUnifiedLog(FIXTURE_LOG, new Map())
  const turns = turnsFor(entries, SESSION_C)
  assert.equal(turns.length, 1)
  assert.equal(turns[0].model, 'grok-code-fast-1')
  assert.notEqual(turns[0].model, 'grok-4.5')

  // Log-derived attribution also wins for session D even with no summary entry.
  const dTurns = turnsFor(entries, SESSION_D)
  assert.deepEqual(dTurns.map((t) => t.model), ['grok-code-fast-1', 'grok-4.5'])
})
