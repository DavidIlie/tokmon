import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROVIDER_META } from '../../../src/config-schema.ts'
import { PROVIDER_MARKS as DESKTOP_PROVIDER_MARKS } from '../../../src/desktop/renderer/provider-icons.ts'
import { PROVIDERS, PROVIDER_MARKS } from './site.ts'

test('provider rows and marks come directly from the shared registries', () => {
  assert.equal(PROVIDER_MARKS, DESKTOP_PROVIDER_MARKS)
  for (const provider of PROVIDERS) {
    assert.equal(provider.name, PROVIDER_META[provider.id].name)
  }
  assert.equal(PROVIDERS.find(provider => provider.id === 'pi')?.name, 'Pi')
})
