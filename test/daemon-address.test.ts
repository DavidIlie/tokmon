import assert from 'node:assert/strict'
import { createServer, get, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULTS, type Config } from '../src/config.ts'
import {
  DAEMON_PORT_SPAN,
  daemonPortBase,
  daemonPortCandidates,
} from '../src/web/daemon-channel.ts'
import { startWebServer, type WebServerController } from '../src/web/server.ts'

const config = (): Config => ({ ...DEFAULTS })

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => { res.statusCode = 404; res.end() })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function close(server: Server): Promise<void> {
  return new Promise(resolve => { server.close(() => resolve()) })
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

/**
 * The contract is "the first free port in the channel's range", not a literal
 * number. Asserting the base directly made the test fail whenever anything on
 * the machine happened to hold it - a developer's own dev daemon, or a leftover
 * from a previous run - which is a flake, not a regression.
 */
async function firstFreeCandidate(channel: 'release' | 'dev'): Promise<number> {
  for (const port of daemonPortCandidates(channel)) {
    if (await isFree(port)) return port
  }
  throw new Error(`no free port in the ${channel} range`)
}

function fetchHeaders(url: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers }, (res) => {
      res.resume()
      res.once('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }))
    })
    req.once('error', reject)
  })
}

test('release and dev own separate, non-overlapping port ranges', () => {
  const release = daemonPortCandidates('release')
  const dev = daemonPortCandidates('dev')
  assert.notEqual(daemonPortBase('release'), daemonPortBase('dev'))
  assert.equal(release.length, DAEMON_PORT_SPAN)
  assert.equal(new Set([...release, ...dev]).size, DAEMON_PORT_SPAN * 2)
  // A dev daemon must never be able to take the port a release dashboard tab
  // is bookmarked at, and vice versa.
  for (const port of dev) assert.ok(!release.includes(port))
})

test('a daemon with no explicit port takes its channel canonical port', async () => {
  const cachePath = await mkdtemp(join(tmpdir(), 'tokmon-address-'))
  let server: WebServerController | null = null
  try {
    const expected = await firstFreeCandidate('dev')
    server = await startWebServer({ config: config(), channel: 'dev' })
    // The whole point: the dashboard origin is predictable, so a tab reopened
    // after a daemon restart lands on a live server instead of a dead port.
    assert.equal(server.port, expected)
    assert.equal(server.url, `http://127.0.0.1:${expected}`)
    // And predictable means inside the range, never an ephemeral port.
    assert.ok(daemonPortCandidates('dev').includes(server.port))
  } finally {
    await server?.stop()
    await rm(cachePath, { recursive: true, force: true })
  }
})

test('a taken canonical port walks the ladder instead of going ephemeral', async () => {
  const candidates = daemonPortCandidates('dev')
  const taken = await firstFreeCandidate('dev')
  const blocker = await occupy(taken)
  let server: WebServerController | null = null
  try {
    // Whatever the daemon would have taken is now held, so it must step past it
    // rather than falling back to an OS-assigned port.
    const expected = await firstFreeCandidate('dev')
    assert.notEqual(expected, taken)
    server = await startWebServer({ config: config(), channel: 'dev' })
    assert.equal(server.port, expected)
    // Still inside the range the browser's recovery scan covers.
    assert.ok(candidates.includes(server.port))
  } finally {
    await server?.stop()
    await close(blocker)
  }
})

test('healthz is readable cross-port by a loopback tab and by nobody else', async () => {
  let server: WebServerController | null = null
  try {
    server = await startWebServer({ config: config(), channel: 'dev' })
    const url = `${server.url}/healthz`

    // A dashboard stranded on another loopback port must be able to read this
    // response, otherwise it can never discover where the daemon moved to.
    const strandedTab = await fetchHeaders(url, { origin: 'http://127.0.0.1:60049' })
    assert.equal(strandedTab.status, 200)
    assert.equal(strandedTab.headers['access-control-allow-origin'], 'http://127.0.0.1:60049')
    assert.equal(strandedTab.headers['vary'], 'Origin')

    const localhostTab = await fetchHeaders(url, { origin: 'http://localhost:4317' })
    assert.equal(localhostTab.headers['access-control-allow-origin'], 'http://localhost:4317')

    // A page on a real site could always *send* this request; it must still be
    // unable to read the reply, exactly as before the header existed.
    for (const origin of ['https://evil.example', 'http://evil.example', 'http://127.0.0.1.evil.example']) {
      const hostile = await fetchHeaders(url, { origin })
      assert.equal(hostile.headers['access-control-allow-origin'], undefined, `leaked to ${origin}`)
    }

    const noOrigin = await fetchHeaders(url, {})
    assert.equal(noOrigin.headers['access-control-allow-origin'], undefined)
  } finally {
    await server?.stop()
  }
})

test('the dashboard is the only thing that gained a cross-origin reader', async () => {
  let server: WebServerController | null = null
  try {
    server = await startWebServer({ config: config(), channel: 'dev' })
    // /api/data and /api/config carry usage data and must stay same-origin only.
    for (const path of ['/api/data', '/api/config']) {
      const res = await fetchHeaders(`${server.url}${path}`, { origin: 'http://127.0.0.1:60049' })
      assert.equal(res.headers['access-control-allow-origin'], undefined, `${path} became cross-origin readable`)
    }
  } finally {
    await server?.stop()
  }
})
