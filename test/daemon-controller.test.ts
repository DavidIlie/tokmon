import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { DEFAULTS, PROVIDER_IDS, type Config } from '../src/config.ts'
import { acquireOrAttachDaemon, type DaemonController } from '../src/web/daemon-controller.ts'
import { acquireLock, readLock, type DaemonLock } from '../src/web/lockfile.ts'
import { TOKMON_CAPABILITIES, TOKMON_PROTOCOL_VERSION } from '../src/rpc/contract.ts'

function testConfig(): Config {
  return {
    ...DEFAULTS,
    accounts: [],
    disabledProviders: [...PROVIDER_IDS],
    knownProviders: [],
    onboarded: true,
  }
}

async function withRoot(
  t: TestContext,
  run: (cachePath: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tokmon-daemon-controller-'))
  const cachePath = join(root, 'cache')
  try {
    await run(cachePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('the sandbox disallows binding ephemeral loopback ports')
      return
    }
    throw error
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('desktop controller owns, publishes, and idempotently releases its daemon', async (t) => {
  await withRoot(t, async (cachePath) => {
    const controller = await acquireOrAttachDaemon({
      ownerKind: 'desktop',
      cachePath,
      port: 0,
      config: testConfig(),
      version: 'desktop-test-version',
    })
    try {
      assert.equal(controller.role, 'owner')
      assert.equal(controller.lock.ownerKind, 'desktop')
      assert.equal(controller.lock.channel, 'release')
      assert.equal(controller.lock.version, 'desktop-test-version')
      assert.match(controller.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/)
      assert.equal(readLock({ cachePath })?.ownerId, controller.lock.ownerId)
      const health = await fetch(`${controller.baseUrl}/healthz`, {
        headers: { 'x-tokmon-token': controller.lock.wsToken },
      }).then(response => response.json()) as { channel?: unknown; owner?: unknown }
      assert.equal(health.channel, 'release')
      assert.equal(health.owner, true)
    } finally {
      await controller.stop()
      await controller.stop()
    }
    assert.equal(readLock({ cachePath }), null)
  })
})

test('an attached controller cannot stop or unlink the owner daemon', async (t) => {
  await withRoot(t, async (cachePath) => {
    const owner = await acquireOrAttachDaemon({
      ownerKind: 'desktop',
      cachePath,
      port: 0,
      config: testConfig(),
    })
    let attached: DaemonController | null = null
    try {
      attached = await acquireOrAttachDaemon({
        ownerKind: 'cli',
        cachePath,
        config: testConfig(),
      })
      assert.equal(owner.role, 'owner')
      assert.equal(attached.role, 'attached')
      assert.equal(attached.baseUrl, owner.baseUrl)
      assert.equal(attached.lock.ownerKind, 'desktop')

      await attached.stop()
      assert.equal(readLock({ cachePath })?.ownerId, owner.lock.ownerId)
    } finally {
      await attached?.stop()
      await owner.stop()
    }
    assert.equal(readLock({ cachePath }), null)
  })
})

test('a ready lock with a reused live PID but no authenticated owner is recovered', async (t) => {
  await withRoot(t, async (cachePath) => {
    const stale: DaemonLock = {
      pid: process.pid,
      port: 1,
      url: 'http://127.0.0.1:1',
      wsToken: 's'.repeat(43),
      version: 'stale-test-version',
      protocolVersion: TOKMON_PROTOCOL_VERSION,
      capabilities: [...TOKMON_CAPABILITIES],
      ownerKind: 'desktop',
      channel: 'release',
      startedAt: Date.now() - 60_000,
      ownerId: 'o'.repeat(43),
      state: 'ready',
    }
    assert.equal(acquireLock(stale, { cachePath }), true)

    const controller = await acquireOrAttachDaemon({
      ownerKind: 'desktop',
      cachePath,
      port: 0,
      config: testConfig(),
      ownerWaitAttempts: 1,
      ownerWaitIntervalMs: 1,
      ownerVerifyTimeoutMs: 20,
    })
    try {
      assert.equal(controller.role, 'owner')
      assert.notEqual(controller.lock.ownerId, stale.ownerId)
      assert.equal(readLock({ cachePath })?.ownerId, controller.lock.ownerId)
    } finally {
      await controller.stop()
    }
  })
})

test('simultaneous desktop contenders produce one owner and one attachment', async (t) => {
  await withRoot(t, async (cachePath) => {
    const options = {
      ownerKind: 'desktop' as const,
      cachePath,
      port: 0,
      config: testConfig(),
    }
    const controllers = await Promise.all([
      acquireOrAttachDaemon(options),
      acquireOrAttachDaemon(options),
    ])
    const owner = controllers.find(controller => controller.role === 'owner')
    const attachment = controllers.find(controller => controller.role === 'attached')
    try {
      assert.ok(owner)
      assert.ok(attachment)
      assert.equal(owner.baseUrl, attachment.baseUrl)
      assert.equal(owner.lock.ownerId, attachment.lock.ownerId)

      await attachment.stop()
      assert.equal(readLock({ cachePath })?.ownerId, owner.lock.ownerId)
    } finally {
      await Promise.all(controllers.map(controller => controller.stop()))
    }
    assert.equal(readLock({ cachePath }), null)
  })
})
