import assert from 'node:assert/strict'
import test from 'node:test'
import type { App } from 'electron'
import {
  readDesktopLoginItem,
  setDesktopLoginItem,
} from './desktop-login-item'

type LoginItemApp = Pick<App, 'getLoginItemSettings' | 'setLoginItemSettings'> & {
  isPackaged: boolean
}

function mockApp(settings: Partial<Electron.LoginItemSettings> = {}): {
  app: LoginItemApp
  reads: Array<Electron.LoginItemSettingsOptions | undefined>
  writes: Electron.Settings[]
} {
  const reads: Array<Electron.LoginItemSettingsOptions | undefined> = []
  const writes: Electron.Settings[] = []
  const current = {
    openAtLogin: false,
    status: 'not-registered',
    executableWillLaunchAtLogin: false,
    ...settings,
  } as Electron.LoginItemSettings
  return {
    app: {
      isPackaged: true,
      getLoginItemSettings: options => {
        reads.push(options)
        return current
      },
      setLoginItemSettings: value => {
        writes.push(value)
        current.openAtLogin = value.openAtLogin ?? false
        current.executableWillLaunchAtLogin = value.openAtLogin ?? false
        current.status = value.openAtLogin ? 'enabled' : 'not-registered'
      },
    },
    reads,
    writes,
  }
}

test('login items are available only to installed release apps on macOS and Windows', () => {
  const development = mockApp()
  development.app.isPackaged = false
  assert.deepEqual(readDesktopLoginItem(development.app, 'darwin', 'release'), {
    status: 'development', enabled: false, error: null,
  })
  assert.deepEqual(setDesktopLoginItem(development.app, 'darwin', 'release', true), {
    status: 'development', enabled: false, error: null,
  })
  assert.equal(development.reads.length, 0)
  assert.equal(development.writes.length, 0)

  const linux = mockApp()
  assert.deepEqual(readDesktopLoginItem(linux.app, 'linux', 'release'), {
    status: 'unsupported', enabled: false, error: null,
  })
  assert.equal(linux.reads.length, 0)
})

test('macOS uses the main app service and exposes approval state', () => {
  const enabled = mockApp()
  assert.deepEqual(setDesktopLoginItem(enabled.app, 'darwin', 'release', true), {
    status: 'enabled', enabled: true, error: null,
  })
  assert.deepEqual(enabled.writes, [{ openAtLogin: true, type: 'mainAppService' }])
  assert.deepEqual(enabled.reads, [{ type: 'mainAppService' }, { type: 'mainAppService' }])

  const approval = mockApp({ openAtLogin: true, status: 'requires-approval' })
  assert.deepEqual(setDesktopLoginItem(approval.app, 'darwin', 'release', true), {
    status: 'requires-approval', enabled: false, error: null,
  })
  assert.equal(approval.writes.length, 0)
})

test('Windows registers the installed executable and respects Startup Apps approval', () => {
  const enabled = mockApp()
  assert.deepEqual(setDesktopLoginItem(enabled.app, 'win32', 'release', true), {
    status: 'enabled', enabled: true, error: null,
  })
  assert.deepEqual(enabled.writes, [{ openAtLogin: true, enabled: true }])
  assert.deepEqual(enabled.reads, [undefined, undefined])

  const startupDisabled = mockApp({
    openAtLogin: true,
    executableWillLaunchAtLogin: false,
  })
  assert.deepEqual(readDesktopLoginItem(startupDisabled.app, 'win32', 'release'), {
    status: 'disabled', enabled: false, error: null,
  })
})

test('native login item failures are reported without crashing settings persistence', () => {
  const app = mockApp().app
  app.setLoginItemSettings = () => { throw new Error('native registration failed') }
  assert.deepEqual(setDesktopLoginItem(app, 'darwin', 'release', true), {
    status: 'error', enabled: false, error: 'native registration failed',
  })
})
