import assert from 'node:assert/strict'
import test from 'node:test'
import { commandForMode, createDevEnvironment, installedDesktopExecutable } from '../scripts/dev-runner.mjs'

test('development runner forces the isolated dev channel without dropping the parent environment', () => {
  const env = createDevEnvironment({ PATH: '/bin', TOKMON_CHANNEL: 'release' })
  assert.equal(env.PATH, '/bin')
  assert.equal(env.TOKMON_CHANNEL, 'dev')
})

test('development modes use cross-platform pnpm commands', () => {
  assert.deepEqual(commandForMode('dev', 'darwin'), {
    command: 'pnpm',
    args: ['exec', 'tsx', 'src/cli.tsx'],
  })
  assert.deepEqual(commandForMode('dev:desktop', 'win32'), {
    command: 'pnpm.cmd',
    args: ['--filter', '@tokmon/desktop', 'run', 'dev'],
  })
})

test('installed development launch resolves the native application executable', () => {
  assert.equal(installedDesktopExecutable('darwin', {}), '/Applications/Tokmon.app/Contents/MacOS/Tokmon')
  assert.equal(
    installedDesktopExecutable('win32', { LOCALAPPDATA: 'C:\\Users\\david\\AppData\\Local' }),
    'C:\\Users\\david\\AppData\\Local/Programs/Tokmon/Tokmon.exe',
  )
  assert.equal(installedDesktopExecutable('darwin', { TOKMON_DESKTOP_APP_PATH: '/tmp/Tokmon' }), '/tmp/Tokmon')
})
