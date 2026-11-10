import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chmod, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cliProxyBilling } from './cliproxy'
import type { Account } from './types'

test('a failed CLIProxy request serves the last reading at its real observation time', async () => {
  const observedAt = new Date(Date.now() - 20 * 60_000).toISOString()
  let up = true
  const server = createServer((_request, response) => {
    if (!up) {
      response.writeHead(503).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      data: [{
        auth_id: 'acct-1',
        provider: 'claude',
        observed_at: observedAt,
        windows: [{ name: 'seven_day', used_percent: 47, resets_at: new Date(Date.now() + 86_400_000).toISOString() }],
      }],
    }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const dir = await mkdtemp(path.join(tmpdir(), 'tokmon-cliproxy-'))
  const keyFile = path.join(dir, 'key')
  await writeFile(keyFile, 'test-key\n')
  await chmod(keyFile, 0o600)
  const account: Account = {
    id: 'cliproxy_claude_test',
    providerId: 'claude',
    name: 'Test',
    color: '#000',
    quotaSource: {
      kind: 'cliproxy',
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      apiKeyEnv: '',
      credentialId: 'acct-1',
      keyFile,
    },
  }
  try {
    const live = await cliProxyBilling(account)
    assert.equal(live.error, null)
    assert.equal(live.metrics[0]?.used, 47)

    up = false
    // A new key-file mtime bypasses the 60s shared-snapshot cache.
    const later = new Date(Date.now() + 5_000)
    await utimes(keyFile, later, later)
    const retained = await cliProxyBilling(account)
    assert.equal(retained.error, null)
    assert.equal(retained.metrics[0]?.used, 47)
    assert.equal(retained.asOfMs, Date.parse(observedAt))
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
