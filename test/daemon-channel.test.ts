import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { cacheDir } from '../src/config.ts'
import {
  daemonChannelFromWire,
  resolveDaemonChannel,
} from '../src/web/daemon-channel.ts'
import { lockfilePath } from '../src/web/lockfile.ts'

test('release and dev resolve to stable, isolated canonical lock namespaces', () => {
  assert.equal(resolveDaemonChannel(undefined, {}), 'release')
  assert.equal(resolveDaemonChannel(undefined, { TOKMON_CHANNEL: 'dev' }), 'dev')
  assert.equal(resolveDaemonChannel(undefined, { TOKMON_CHANNEL: 'release' }), 'release')
  assert.equal(lockfilePath({ channel: 'release' }), join(cacheDir(), 'daemon.json'))
  assert.equal(lockfilePath({ channel: 'dev' }), join(cacheDir(), 'dev', 'daemon.json'))
})

test('an absolute cache override is exact and is never channel-nested', () => {
  const override = join(cacheDir(), 'test-override')
  assert.equal(lockfilePath({ cachePath: override, channel: 'release' }), join(override, 'daemon.json'))
  assert.equal(lockfilePath({ cachePath: override, channel: 'dev' }), join(override, 'daemon.json'))
})

test('wire data without a channel is release-compatible only', () => {
  assert.equal(daemonChannelFromWire(undefined), 'release')
  assert.equal(daemonChannelFromWire('release'), 'release')
  assert.equal(daemonChannelFromWire('dev'), 'dev')
  assert.equal(daemonChannelFromWire('preview'), null)
})
