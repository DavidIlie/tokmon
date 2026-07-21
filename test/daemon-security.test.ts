import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, request } from 'node:http'
import { connect, type Socket } from 'node:net'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { attachOrSpawn } from '../src/client/daemon-handle.ts'
import { createDaemonRpcClient } from '../src/client/daemon-rpc-client.ts'
import { DEFAULTS, PROVIDER_IDS, type Config } from '../src/config.ts'
import { TOKMON_CAPABILITIES, TOKMON_PROTOCOL_VERSION } from '../src/rpc/contract.ts'
import { acquireOrAttachDaemon, type DaemonController } from '../src/web/daemon-controller.ts'
import {
  acquireLock,
  lockfilePath,
  probeHealth,
  readLock,
  reclaimAbandonedLock,
  reclaimDeadLock,
  unlinkLock,
  writeLock,
  type DaemonLock,
} from '../src/web/lockfile.ts'

const token = 'a'.repeat(43)

function lock(ownerId = 'b'.repeat(43)): DaemonLock {
  return {
    pid: process.pid,
    port: 4317,
    url: 'http://127.0.0.1:4317',
    wsToken: token,
    version: 'test',
    protocolVersion: TOKMON_PROTOCOL_VERSION,
    capabilities: [...TOKMON_CAPABILITIES],
    ownerKind: 'cli',
    channel: 'release',
    startedAt: Date.now(),
    ownerId,
    state: 'starting',
  }
}

test('daemon lock is exclusive, owner-only, and mode 0600', async () => {
  const cachePath = await mkdtemp(join(tmpdir(), 'tokmon-daemon-test-'))
  try {
    await chmod(cachePath, 0o755)
    const first = lock()
    assert.equal(acquireLock(first, { cachePath }), true)
    assert.equal(acquireLock(lock('c'.repeat(43)), { cachePath }), false)
    assert.equal((await stat(cachePath)).mode & 0o777, 0o700)
    assert.equal((await stat(lockfilePath({ cachePath }))).mode & 0o777, 0o600)
    assert.equal(unlinkLock('not-the-owner', { cachePath }), false)
    assert.equal(readLock({ cachePath })?.state, 'starting')
    const { channel: _legacyChannel, ...legacyReleaseLock } = first
    await writeFile(lockfilePath({ cachePath }), JSON.stringify(legacyReleaseLock), { mode: 0o600 })
    assert.equal(readLock({ cachePath })?.channel, 'release')
    assert.equal(readLock({ cachePath, channel: 'dev' }), null)
    assert.equal(writeLock({ ...first, state: 'ready' }, { cachePath }), true)
    assert.equal(readLock({ cachePath })?.state, 'ready')
    assert.equal(unlinkLock(first.ownerId, { cachePath }), true)
  } finally {
    await rm(cachePath, { recursive: true, force: true })
  }
})

test('only a proven-dead stale owner can be reclaimed', async () => {
  const cachePath = await mkdtemp(join(tmpdir(), 'tokmon-daemon-test-'))
  try {
    const stale = { ...lock(), pid: 2_147_483_647, ownerId: 'd'.repeat(43) }
    assert.equal(acquireLock(stale, { cachePath }), true)
    assert.equal(reclaimDeadLock({ cachePath }), true)
    assert.equal(readLock({ cachePath }), null)
  } finally {
    await rm(cachePath, { recursive: true, force: true })
  }
})

test('abandoned legacy and ownerless partial locks are reclaimed without racing live owners', async () => {
  const cachePath = await mkdtemp(join(tmpdir(), 'tokmon-daemon-test-'))
  const path = lockfilePath({ cachePath })
  try {
    await writeFile(path, JSON.stringify({ pid: process.pid }), { mode: 0o600 })
    assert.equal(reclaimAbandonedLock({ cachePath }, 0), false)

    await writeFile(path, JSON.stringify({ pid: 2_147_483_647 }), { mode: 0o600 })
    assert.equal(reclaimAbandonedLock({ cachePath }), true)

    await writeFile(path, '{', { mode: 0o600 })
    assert.equal(reclaimAbandonedLock({ cachePath }, 10_000), false)
    const old = new Date(Date.now() - 20_000)
    await utimes(path, old, old)
    assert.equal(reclaimAbandonedLock({ cachePath }, 10_000), true)
  } finally {
    await rm(cachePath, { recursive: true, force: true })
  }
})

test('health verification requires the owner token on an ephemeral loopback port', async (t) => {
  const server = createServer((req, res) => {
    const owner = req.headers['x-tokmon-token'] === token
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      ok: true,
      owner,
      version: 'test',
      protocolVersion: TOKMON_PROTOCOL_VERSION,
      capabilities: TOKMON_CAPABILITIES,
      ownerKind: 'cli',
    }))
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('the sandbox disallows binding ephemeral loopback ports')
      return
    }
    throw error
  }
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const url = `http://127.0.0.1:${address.port}`
  try {
    const expected = {
      version: 'test',
      protocolVersion: TOKMON_PROTOCOL_VERSION,
      capabilities: TOKMON_CAPABILITIES,
      ownerKind: 'cli' as const,
      channel: 'release' as const,
    }
    assert.equal(await probeHealth(url, token, expected), true)
    assert.equal(await probeHealth(url, 'wrong-token', expected), false)
    assert.equal(await probeHealth(url, token, { ...expected, version: 'wrong-version' }), false)
    assert.equal(await probeHealth(url, token, { ...expected, protocolVersion: TOKMON_PROTOCOL_VERSION + 1 }), false)
    assert.equal(await probeHealth(url, token, { ...expected, ownerKind: 'desktop' }), false)
    assert.equal(await probeHealth(url, token, { ...expected, channel: 'dev' }), false)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

interface Handshake {
  ready: 1
  url: string
  port: number
  wsToken: string
  version: string
  protocolVersion: number
  capabilities: string[]
  ownerKind: 'cli' | 'desktop'
}

function daemonProcess(root: string): { child: ChildProcess; handshake: Promise<Handshake> } {
  const child = spawn(process.execPath, [
    '--import', 'tsx', join(process.cwd(), 'src/cli.tsx'), '__daemon', '--port', '0', '--no-open',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: join(root, 'home'),
      TOKMON_DAEMON_CACHE_DIR: join(root, 'cache'),
      TOKMON_WEB_MODE: 'prod',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const handshake = new Promise<Handshake>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`daemon handshake timed out: ${stderr}`)), 15_000)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', chunk => {
      stdout += chunk
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      try {
        const parsed = JSON.parse(stdout.slice(0, newline)) as Handshake
        assert.equal(parsed.ready, 1)
        clearTimeout(timer)
        resolve(parsed)
      } catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => {
      if (stdout.indexOf('\n') === -1) {
        clearTimeout(timer)
        reject(new Error(`daemon exited before handshake (${code}): ${stderr}`))
      }
    })
  })
  return { child, handshake }
}

function waitForExit(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('daemon did not exit')), timeoutMs)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

function testDaemon(root: string, options: {
  version: string
  protocolVersion: number
  ownerKind: 'cli' | 'desktop'
  legacy?: boolean
}): { child: ChildProcess; handshake: Promise<Handshake> } {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { createServer } from 'node:http'
    import { mkdir, unlink, writeFile } from 'node:fs/promises'
    import { join } from 'node:path'
    const cachePath = process.env.TOKMON_DAEMON_CACHE_DIR
    const token = process.env.TOKMON_TEST_TOKEN
    const ownerId = process.env.TOKMON_TEST_OWNER
    const version = process.env.TOKMON_TEST_VERSION
    const protocolVersion = Number(process.env.TOKMON_TEST_PROTOCOL_VERSION)
    const capabilities = JSON.parse(process.env.TOKMON_TEST_CAPABILITIES)
    const ownerKind = process.env.TOKMON_TEST_OWNER_KIND
    const legacy = process.env.TOKMON_TEST_LEGACY === '1'
    const lockPath = join(cachePath, 'daemon.json')
    const server = createServer((req, res) => {
      const owner = req.headers['x-tokmon-token'] === token
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        ok: true,
        owner,
        version,
        ...(legacy ? {} : { protocolVersion, capabilities, ownerKind, channel: 'release' }),
      }))
    })
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address()
      const lock = {
        pid: process.pid,
        port: address.port,
        url: 'http://127.0.0.1:' + address.port,
        wsToken: token,
        version,
        ...(legacy ? {} : { protocolVersion, capabilities, ownerKind, channel: 'release' }),
        startedAt: Date.now(),
        ownerId,
        state: 'ready',
      }
      await mkdir(cachePath, { recursive: true, mode: 0o700 })
      await writeFile(lockPath, JSON.stringify(lock), { mode: 0o600 })
      process.stdout.write(JSON.stringify({
        ready: 1,
        url: lock.url,
        port: lock.port,
        wsToken: token,
        version,
        protocolVersion,
        capabilities,
        ownerKind,
      }) + '\\n')
    })
    const shutdown = () => server.close(async () => {
      await unlink(lockPath).catch(() => {})
      process.exit(0)
    })
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  `], {
    env: {
      ...process.env,
      TOKMON_DAEMON_CACHE_DIR: join(root, 'cache'),
      TOKMON_TEST_TOKEN: 'u'.repeat(43),
      TOKMON_TEST_OWNER: 'v'.repeat(43),
      TOKMON_TEST_VERSION: options.version,
      TOKMON_TEST_PROTOCOL_VERSION: String(options.protocolVersion),
      TOKMON_TEST_CAPABILITIES: JSON.stringify(TOKMON_CAPABILITIES),
      TOKMON_TEST_OWNER_KIND: options.ownerKind,
      TOKMON_TEST_LEGACY: options.legacy ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const handshake = new Promise<Handshake>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`incompatible daemon handshake timed out: ${stderr}`)), 5_000)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', chunk => {
      stdout += chunk
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      try { resolve(JSON.parse(stdout.slice(0, newline)) as Handshake) } catch (error) { reject(error) }
    })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => {
      if (!stdout.includes('\n')) {
        clearTimeout(timer)
        reject(new Error(`incompatible daemon exited before handshake (${code}): ${stderr}`))
      }
    })
  })
  return { child, handshake }
}

test('a client attaches across app-version mismatch when the daemon protocol matches', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tokmon-daemon-compatible-version-'))
  await mkdir(join(root, 'home'), { recursive: true })
  const existing = testDaemon(root, {
    version: '0.22.7',
    protocolVersion: TOKMON_PROTOCOL_VERSION,
    ownerKind: 'cli',
  })
  try {
    const ready = await existing.handshake
    const handle = await attachOrSpawn({
      cachePath: join(root, 'cache'),
      entry: join(process.cwd(), 'src/cli.tsx'),
      execArgv: ['--import', 'tsx'],
      timeoutMs: 1_000,
    })
    assert.equal(handle.kind, 'spawned')
    assert.equal(handle.baseUrl, ready.url)
    assert.equal(existing.child.exitCode, null)
    assert.equal(readLock({ cachePath: join(root, 'cache') })?.pid, existing.child.pid)
  } finally {
    if (existing.child.exitCode === null && existing.child.signalCode === null) existing.child.kill('SIGTERM')
    await waitForExit(existing.child).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

test('a new client replaces an authenticated protocol-incompatible CLI daemon instead of degrading', { timeout: 20_000 }, async (t) => {
  if (process.platform === 'win32') {
    t.skip('signal-based upgrade assertion is POSIX-specific')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'tokmon-daemon-upgrade-'))
  await mkdir(join(root, 'home'), { recursive: true })
  const old = testDaemon(root, {
    version: '0.22.7',
    protocolVersion: TOKMON_PROTOCOL_VERSION + 1,
    ownerKind: 'cli',
  })
  let replacementPid: number | null = null
  try {
    await old.handshake
    const handle = await attachOrSpawn({
      cachePath: join(root, 'cache'),
      entry: join(process.cwd(), 'src/cli.tsx'),
      execArgv: ['--import', 'tsx'],
      env: {
        ...process.env,
        HOME: join(root, 'home'),
        TOKMON_WEB_MODE: 'prod',
      },
      timeoutMs: 5_000,
    })
    assert.equal(handle.kind, 'spawned')
    await waitForExit(old.child, 3_000)
    const replacement = readLock({ cachePath: join(root, 'cache') })
    assert.ok(replacement)
    assert.equal(replacement.protocolVersion, TOKMON_PROTOCOL_VERSION)
    assert.equal(replacement.ownerKind, 'cli')
    replacementPid = replacement.pid
  } finally {
    if (old.child.exitCode === null && old.child.signalCode === null) old.child.kill('SIGKILL')
    await waitForExit(old.child).catch(() => {})
    if (replacementPid) {
      try { process.kill(replacementPid, 'SIGTERM') } catch {}
      for (let i = 0; i < 50 && readLock({ cachePath: join(root, 'cache') }); i++) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('a new client safely takes over an authenticated legacy CLI lock', { timeout: 20_000 }, async (t) => {
  if (process.platform === 'win32') {
    t.skip('signal-based upgrade assertion is POSIX-specific')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'tokmon-daemon-legacy-upgrade-'))
  await mkdir(join(root, 'home'), { recursive: true })
  const old = testDaemon(root, {
    version: '0.28.1',
    protocolVersion: TOKMON_PROTOCOL_VERSION - 1,
    ownerKind: 'cli',
    legacy: true,
  })
  let replacementPid: number | null = null
  try {
    await old.handshake
    const cachePath = join(root, 'cache')
    assert.equal(readLock({ cachePath }), null, 'strict discovery must not trust a legacy lock')
    const handle = await attachOrSpawn({
      cachePath,
      entry: join(process.cwd(), 'src/cli.tsx'),
      execArgv: ['--import', 'tsx'],
      env: {
        ...process.env,
        HOME: join(root, 'home'),
        TOKMON_WEB_MODE: 'prod',
      },
      timeoutMs: 5_000,
    })
    assert.equal(handle.kind, 'spawned')
    await waitForExit(old.child, 3_000)
    const replacement = readLock({ cachePath })
    assert.ok(replacement)
    assert.equal(replacement.protocolVersion, TOKMON_PROTOCOL_VERSION)
    assert.equal(replacement.channel, 'release')
    replacementPid = replacement.pid
  } finally {
    if (old.child.exitCode === null && old.child.signalCode === null) old.child.kill('SIGKILL')
    await waitForExit(old.child).catch(() => {})
    if (replacementPid) {
      try { process.kill(replacementPid, 'SIGTERM') } catch {}
      for (let i = 0; i < 50 && readLock({ cachePath: join(root, 'cache') }); i++) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('the desktop replaces an authenticated protocol-v3 CLI daemon before decoding snapshots', { timeout: 20_000 }, async (t) => {
  if (process.platform === 'win32') {
    t.skip('signal-based upgrade assertion is POSIX-specific')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'tokmon-desktop-legacy-upgrade-'))
  await mkdir(join(root, 'home'), { recursive: true })
  const old = testDaemon(root, {
    version: '0.28.2',
    protocolVersion: TOKMON_PROTOCOL_VERSION - 1,
    ownerKind: 'cli',
  })
  let controller: DaemonController | null = null
  try {
    const oldReady = await old.handshake
    assert.equal(oldReady.protocolVersion, 3)
    const config: Config = {
      ...DEFAULTS,
      accounts: [],
      disabledProviders: [...PROVIDER_IDS],
      knownProviders: [],
      onboarded: true,
    }
    controller = await acquireOrAttachDaemon({
      ownerKind: 'desktop',
      cachePath: join(root, 'cache'),
      port: 0,
      config,
    })
    assert.equal(controller.role, 'owner')
    assert.equal(controller.lock.ownerKind, 'desktop')
    assert.equal(controller.lock.channel, 'release')
    await waitForExit(old.child, 3_000)
  } finally {
    await controller?.stop()
    if (old.child.exitCode === null && old.child.signalCode === null) old.child.kill('SIGKILL')
    await waitForExit(old.child).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

test('an incompatible desktop-owned daemon is never signalled', { timeout: 10_000 }, async (t) => {
  if (process.platform === 'win32') {
    t.skip('signal-based upgrade assertion is POSIX-specific')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'tokmon-daemon-desktop-owner-'))
  await mkdir(join(root, 'home'), { recursive: true })
  const desktop = testDaemon(root, {
    version: 'desktop-test',
    protocolVersion: TOKMON_PROTOCOL_VERSION + 1,
    ownerKind: 'desktop',
  })
  try {
    await desktop.handshake
    const handle = await attachOrSpawn({
      cachePath: join(root, 'cache'),
      entry: join(process.cwd(), 'src/cli.tsx'),
      execArgv: ['--import', 'tsx'],
      env: {
        ...process.env,
        HOME: join(root, 'home'),
        TOKMON_WEB_MODE: 'prod',
      },
      timeoutMs: 500,
    })
    assert.equal(handle.kind, 'degraded')
    assert.deepEqual(handle.issue && {
      kind: handle.issue.kind,
      ownerVersion: handle.issue.ownerVersion,
      ownerProtocolVersion: handle.issue.ownerProtocolVersion,
      clientProtocolVersion: handle.issue.clientProtocolVersion,
    }, {
      kind: 'incompatible-desktop',
      ownerVersion: 'desktop-test',
      ownerProtocolVersion: TOKMON_PROTOCOL_VERSION + 1,
      clientProtocolVersion: TOKMON_PROTOCOL_VERSION,
    })
    assert.match(handle.issue?.message ?? '', /Update the CLI/)
    assert.match(handle.issue?.message ?? '', /minimum-release-age=0/)
    assert.equal(desktop.child.exitCode, null)
    assert.equal(readLock({ cachePath: join(root, 'cache') })?.ownerKind, 'desktop')
  } finally {
    if (desktop.child.exitCode === null && desktop.child.signalCode === null) desktop.child.kill('SIGKILL')
    await waitForExit(desktop.child).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

test('an incompatible CLI daemon is never signalled when owner authentication fails', { timeout: 10_000 }, async (t) => {
  if (process.platform === 'win32') {
    t.skip('signal-based upgrade assertion is POSIX-specific')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'tokmon-daemon-unverified-'))
  await mkdir(join(root, 'home'), { recursive: true })
  const old = testDaemon(root, {
    version: '0.22.7',
    protocolVersion: TOKMON_PROTOCOL_VERSION + 1,
    ownerKind: 'cli',
  })
  try {
    await old.handshake
    const cachePath = join(root, 'cache')
    const current = readLock({ cachePath })
    assert.ok(current)
    await writeFile(lockfilePath({ cachePath }), JSON.stringify({
      ...current,
      wsToken: 'w'.repeat(43),
    }), { mode: 0o600 })

    const handle = await attachOrSpawn({
      cachePath,
      entry: join(process.cwd(), 'src/cli.tsx'),
      execArgv: ['--import', 'tsx'],
      env: {
        ...process.env,
        HOME: join(root, 'home'),
        TOKMON_WEB_MODE: 'prod',
      },
      timeoutMs: 500,
    })
    assert.equal(handle.kind, 'degraded')
    assert.equal(old.child.exitCode, null)
  } finally {
    if (old.child.exitCode === null && old.child.signalCode === null) old.child.kill('SIGKILL')
    await waitForExit(old.child).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

function openWebSocket(port: number, host = '127.0.0.1', origin?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let response = ''
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('websocket upgrade timed out')) }, 3_000)
    socket.once('error', error => { clearTimeout(timer); reject(error) })
    socket.on('data', chunk => {
      response += chunk.toString('utf8')
      if (!response.includes('\r\n\r\n')) return
      clearTimeout(timer)
      if (response.startsWith('HTTP/1.1 101')) resolve(socket)
      else { socket.destroy(); reject(new Error(response.split('\r\n')[0])) }
    })
    socket.once('connect', () => {
      socket.write([
        'GET /ws HTTP/1.1',
        `Host: ${host}:${port}`,
        ...(origin ? [`Origin: ${origin}`] : []),
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '', '',
      ].join('\r\n'))
    })
  })
}

function requestStatus(url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, res => {
      res.resume()
      res.once('end', () => resolve(res.statusCode ?? 0))
    })
    req.once('error', reject)
    req.end()
  })
}

test('real daemon is singleton, loopback/same-origin guarded, durable, and bounded on websocket shutdown', { timeout: 30_000 }, async (t) => {
  if (process.platform === 'win32') {
    t.skip('signal-based lifecycle assertion is POSIX-specific')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'tokmon-daemon-integration-'))
  await mkdir(join(root, 'home'), { recursive: true })
  const contenders: ReturnType<typeof daemonProcess>[] = []
  let owner: ChildProcess | null = null
  let tui: ChildProcess | null = null
  let socket: Socket | null = null
  try {
    contenders.push(...Array.from({ length: 4 }, () => daemonProcess(root)))
    const handshakes = await Promise.all(contenders.map(contender => contender.handshake))
    const ready = handshakes[0]
    assert.ok(handshakes.every(item => item.port === ready.port && item.wsToken === ready.wsToken))
    const lock = JSON.parse(await readFile(join(root, 'cache', 'daemon.json'), 'utf8')) as DaemonLock
    owner = contenders.find(contender => contender.child.pid === lock.pid)?.child ?? null
    assert.ok(owner)
    assert.equal(lock.pid, owner.pid)
    assert.equal(lock.port, ready.port)
    await Promise.all(contenders.filter(contender => contender.child !== owner).map(contender => waitForExit(contender.child)))

    const handle = await attachOrSpawn({ cachePath: join(root, 'cache') })
    assert.equal(handle.kind, 'spawned')
    assert.match(handle.baseUrl ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.equal(new URL(handle.baseUrl ?? 'http://invalid').search, '')
    const rpc = createDaemonRpcClient(handle.baseUrl!, { transport: 'node' })
    try {
      assert.equal((await rpc.getConfig()).protocol.version, TOKMON_PROTOCOL_VERSION)
    } finally {
      await rpc.close()
    }

    tui = spawn(process.execPath, ['--import', 'tsx', join(process.cwd(), 'src/cli.tsx')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: join(root, 'home'),
        TOKMON_DAEMON_CACHE_DIR: join(root, 'cache'),
        TOKMON_WEB_MODE: 'prod',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(tui.exitCode, null, 'TUI should remain active after attaching')
    const tuiExitStarted = Date.now()
    tui.kill('SIGINT')
    await waitForExit(tui, 3_000)
    assert.ok(Date.now() - tuiExitStarted < 3_000, 'Ctrl-C should close the TUI promptly')
    assert.equal(owner.exitCode, null, 'Ctrl-C should leave the background daemon running')
    assert.equal(await probeHealth(ready.url, ready.wsToken, {
      version: ready.version,
      protocolVersion: ready.protocolVersion,
      capabilities: ready.capabilities,
      ownerKind: ready.ownerKind,
    }), true)

    assert.equal((await fetch(`${ready.url}/healthz`)).status, 200)
    assert.equal(await requestStatus(`${ready.url}/healthz`, { host: 'evil.example' }), 403)
    assert.equal(await requestStatus(`${ready.url}/api/data`, { host: 'evil.example' }), 403)
    assert.equal((await fetch(`${ready.url}/api/config`)).status, 200)
    assert.equal((await fetch(`${ready.url}/api/config`, {
      headers: { origin: 'https://evil.example' },
    })).status, 403)

    await assert.rejects(openWebSocket(ready.port, 'evil.example'), /HTTP\/1\.1 403/)
    await assert.rejects(openWebSocket(ready.port, '127.0.0.1', 'https://evil.example'), /HTTP\/1\.1 403/)
    socket = await openWebSocket(ready.port)

    const started = Date.now()
    owner.kill('SIGTERM')
    await waitForExit(owner, 3_000)
    assert.ok(Date.now() - started < 3_000)
    assert.equal(await readFile(join(root, 'cache', 'daemon.json'), 'utf8').then(() => true, () => false), false)
  } finally {
    socket?.destroy()
    if (tui && tui.exitCode === null && tui.signalCode === null) {
      tui.kill('SIGKILL')
      await waitForExit(tui).catch(() => {})
    }
    await Promise.all(contenders.map(async ({ child }) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGKILL')
      await waitForExit(child).catch(() => {})
    }))
    await rm(root, { recursive: true, force: true })
  }
})
