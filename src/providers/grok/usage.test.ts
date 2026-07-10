import assert from 'node:assert/strict'
import test from 'node:test'
import { grokModelMapFingerprint } from './usage'

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
