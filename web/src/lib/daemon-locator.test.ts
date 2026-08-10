import assert from 'node:assert/strict'
import test from 'node:test'
import { candidatePorts, channelForPort, findRelocatedDaemon, isLoopbackHostname } from './daemon-locator'
import { DAEMON_PORT_SPAN, daemonPortCandidates } from '../../../src/web/daemon-channel'

const health = (body: unknown, ok = true) => ({
  ok,
  json: async () => body,
}) as unknown as Response

function fetchReturning(liveOrigins: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    const origin = url.replace(/\/healthz$/, '')
    if (!(origin in liveOrigins)) throw new Error('ECONNREFUSED')
    return health(liveOrigins[origin])
  }) as unknown as typeof fetch
}

const TOKMON = { ok: true, version: '0.32.0', protocolVersion: 5 }

test('the recovery scan covers every port the binder may occupy', () => {
  // If the scan were narrower than the bind ladder, a daemon could bind
  // somewhere no stranded tab would ever look — which is the bug itself.
  const release = daemonPortCandidates('release')
  const dev = daemonPortCandidates('dev')
  assert.equal(release.length, DAEMON_PORT_SPAN)
  assert.equal(dev.length, DAEMON_PORT_SPAN)
  const scanned = new Set(candidatePorts(release[0]!))
  for (const port of [...release.slice(1), ...dev]) assert.ok(scanned.has(port), `port ${port} is unreachable by the scan`)
})

test('the current port is never rescanned and dev tabs search dev first', () => {
  const release = daemonPortCandidates('release')
  const dev = daemonPortCandidates('dev')
  assert.ok(!candidatePorts(release[0]!).includes(release[0]!))
  assert.equal(candidatePorts(dev[0]!)[0], dev[1])
  assert.equal(candidatePorts(release[0]!)[0], release[1])
})

test('a tab stranded on an ephemeral port finds the daemon on the canonical port', async () => {
  const base = daemonPortCandidates('release')[0]!
  const found = await findRelocatedDaemon({
    hostname: '127.0.0.1',
    protocol: 'http:',
    currentPort: 60049, // an ephemeral port from a build that predates fixed ports
    fetchImpl: fetchReturning({ [`http://127.0.0.1:${base}`]: TOKMON }),
  })
  assert.equal(found, `http://127.0.0.1:${base}`)
})

test('a daemon pushed down the ladder by a port conflict is still found', async () => {
  const third = daemonPortCandidates('release')[2]!
  const found = await findRelocatedDaemon({
    hostname: '127.0.0.1',
    protocol: 'http:',
    currentPort: daemonPortCandidates('release')[0]!,
    fetchImpl: fetchReturning({ [`http://127.0.0.1:${third}`]: TOKMON }),
  })
  assert.equal(found, `http://127.0.0.1:${third}`)
})

test('a stranger answering on a candidate port is never navigated to', async () => {
  const base = daemonPortCandidates('release')[0]!
  const found = await findRelocatedDaemon({
    hostname: '127.0.0.1',
    protocol: 'http:',
    currentPort: 60049,
    // Some other local dev server. It answers 200 but is not tokmon.
    fetchImpl: fetchReturning({ [`http://127.0.0.1:${base}`]: { hello: 'world' } }),
  })
  assert.equal(found, null)
})

test('an older daemon without a protocol version is still a valid destination', async () => {
  const base = daemonPortCandidates('release')[0]!
  const found = await findRelocatedDaemon({
    hostname: '127.0.0.1',
    protocol: 'http:',
    currentPort: 60049,
    fetchImpl: fetchReturning({ [`http://127.0.0.1:${base}`]: { ok: true, version: '0.28.5' } }),
  })
  assert.equal(found, `http://127.0.0.1:${base}`)
})

test('nothing is probed when the dashboard is not being viewed over loopback', async () => {
  let probes = 0
  const counting = (async () => { probes += 1; throw new Error('nope') }) as unknown as typeof fetch
  // allowNetworkAccess lets a dashboard be opened from another machine. Port
  // scanning that host is not this feature's business.
  assert.equal(await findRelocatedDaemon({
    hostname: '192.168.1.22', protocol: 'http:', currentPort: 4317, fetchImpl: counting,
  }), null)
  assert.equal(await findRelocatedDaemon({
    hostname: '127.0.0.1', protocol: 'https:', currentPort: 4317, fetchImpl: counting,
  }), null)
  assert.equal(probes, 0)
  assert.equal(isLoopbackHostname('localhost'), true)
  assert.equal(isLoopbackHostname('[::1]'), true)
  assert.equal(isLoopbackHostname('192.168.1.22'), false)
})

test('no daemon anywhere on the ladder resolves to null rather than hanging', async () => {
  const found = await findRelocatedDaemon({
    hostname: 'localhost',
    protocol: 'http:',
    currentPort: 4317,
    fetchImpl: fetchReturning({}),
  })
  assert.equal(found, null)
})

test('a dev tab is never offered the release daemon, or the reverse', async () => {
  const release = daemonPortCandidates('release')[0]!
  const dev = daemonPortCandidates('dev')[0]!

  // Release and dev are separate installations with separate data. A dev tab
  // relocated onto release would silently show the wrong install's usage.
  assert.equal(await findRelocatedDaemon({
    hostname: '127.0.0.1',
    protocol: 'http:',
    currentPort: daemonPortCandidates('dev')[1]!,
    fetchImpl: fetchReturning({ [`http://127.0.0.1:${release}`]: { ...TOKMON, channel: 'release' } }),
  }), null)

  assert.equal(await findRelocatedDaemon({
    hostname: '127.0.0.1',
    protocol: 'http:',
    currentPort: daemonPortCandidates('release')[1]!,
    fetchImpl: fetchReturning({ [`http://127.0.0.1:${dev}`]: { ...TOKMON, channel: 'dev' } }),
  }), null)

  // ...but each still finds its own.
  assert.equal(await findRelocatedDaemon({
    hostname: '127.0.0.1',
    protocol: 'http:',
    currentPort: daemonPortCandidates('dev')[1]!,
    fetchImpl: fetchReturning({ [`http://127.0.0.1:${dev}`]: { ...TOKMON, channel: 'dev' } }),
  }), `http://127.0.0.1:${dev}`)
})

test('a tab on a legacy ephemeral port is treated as release', async () => {
  const release = daemonPortCandidates('release')[0]!
  assert.equal(channelForPort(60049), 'release')
  assert.equal(channelForPort(daemonPortCandidates('dev')[3]!), 'dev')
  // Daemons predating channels omit the field and occupied release.
  assert.equal(await findRelocatedDaemon({
    hostname: '127.0.0.1',
    protocol: 'http:',
    currentPort: 60049,
    fetchImpl: fetchReturning({ [`http://127.0.0.1:${release}`]: { ok: true, version: '0.28.5' } }),
  }), `http://127.0.0.1:${release}`)
})
