import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { copilotBilling, ghHostsPath } from './billing'

test('Copilot user-info request matches the current upstream headers', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'tokmon-copilot-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const hosts = ghHostsPath(home)
  await mkdir(dirname(hosts), { recursive: true })
  await writeFile(hosts, 'github.com:\n    oauth_token: test-token\n')
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    requests++
    assert.equal(String(url), 'https://api.github.com/copilot_internal/user')
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('authorization'), 'token test-token')
    assert.equal(headers.get('x-github-api-version'), '2025-04-01')
    assert.equal(headers.get('user-agent'), 'GitHubCopilotChat/0.44.0')
    assert.equal(headers.has('editor-version'), false)
    assert.equal(headers.has('editor-plugin-version'), false)
    return new Response(JSON.stringify({ copilot_plan: 'individual', token_based_billing: true }), { headers: { 'Content-Type': 'application/json' } })
  })
  const result = await copilotBilling({ id: 'test', providerId: 'copilot', name: 'test', color: '#000', homeDir: home })
  assert.equal(requests, 1)
  assert.equal(result.error, null)
  assert.equal(result.plan, 'individual')
})
