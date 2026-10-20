import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { DesktopUpdateState } from '../shared/desktop-contract'
import {
  compareReleaseVersions,
  DesktopUpdaterController,
  UPDATE_DOWNLOAD_WATCHDOG_MS,
  type DesktopAutoUpdater,
  type DesktopUpdaterScheduler,
} from './desktop-updater'

class FakeUpdater extends EventEmitter implements DesktopAutoUpdater {
  autoDownload = false
  autoInstallOnAppQuit = false
  checks = 0
  installs: Array<[boolean | undefined, boolean | undefined]> = []
  nextError: Error | null = null
  pendingCheck: Promise<unknown> | null = null
  nextResult: unknown = null
  installError: Error | null = null
  onCheck: (() => void) | null = null
  onInstall: (() => void) | null = null

  async checkForUpdates(): Promise<unknown> {
    this.checks += 1
    this.onCheck?.()
    if (this.nextError) throw this.nextError
    if (this.pendingCheck) return this.pendingCheck
    return this.nextResult
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    if (this.installError) throw this.installError
    this.installs.push([isSilent, isForceRunAfter])
    this.onInstall?.()
  }
}

class FakeScheduler implements DesktopUpdaterScheduler {
  timeouts: Array<{ callback: () => void; delayMs: number; handle: ReturnType<typeof setTimeout> }> = []
  intervals: Array<{ callback: () => void; delayMs: number; handle: ReturnType<typeof setTimeout> }> = []
  clearedTimeouts: ReturnType<typeof setTimeout>[] = []
  clearedIntervals: ReturnType<typeof setTimeout>[] = []

  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const handle = fakeHandle()
    this.timeouts.push({ callback, delayMs, handle })
    return handle
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>): void { this.clearedTimeouts.push(handle) }

  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const handle = fakeHandle()
    this.intervals.push({ callback, delayMs, handle })
    return handle
  }

  clearInterval(handle: ReturnType<typeof setTimeout>): void { this.clearedIntervals.push(handle) }
}

function fakeHandle(): ReturnType<typeof setTimeout> {
  return { unref() { return this } } as unknown as ReturnType<typeof setTimeout>
}

function setup(enabled = true, supported = true) {
  const updater = new FakeUpdater()
  const scheduler = new FakeScheduler()
  const states: DesktopUpdateState[] = []
  const warnings: unknown[][] = []
  const controller = new DesktopUpdaterController({
    enabled,
    supported,
    updater,
    scheduler,
    onState: state => states.push({ ...state }),
    logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
  })
  return { controller, updater, scheduler, states, warnings }
}

test('updater publishes availability, progress, completion and stages only downloaded updates', () => {
  const { controller, updater, scheduler, states } = setup()
  controller.start()

  assert.equal(controller.requestInstall(), false)
  updater.emit('update-available', { version: '1.2.3' })
  assert.deepEqual(states.at(-1), {
    status: 'available', availableVersion: '1.2.3', progressPercent: null, error: null,
  })
  updater.emit('download-progress', { percent: 42.25 })
  assert.equal(states.at(-1)?.status, 'downloading')
  assert.equal(states.at(-1)?.progressPercent, 42.25)
  assert.equal(scheduler.timeouts.filter(timer => timer.delayMs === UPDATE_DOWNLOAD_WATCHDOG_MS).length, 2)
  updater.emit('update-downloaded', { version: '1.2.3' })
  assert.deepEqual(states.at(-1), {
    status: 'downloaded', availableVersion: '1.2.3', progressPercent: 100, error: null,
  })
  void controller.checkForUpdates()
  assert.equal(updater.checks, 0)

  assert.equal(controller.requestInstall(), true)
  assert.deepEqual(states.at(-1), {
    status: 'restarting', availableVersion: '1.2.3', progressPercent: 100, error: null,
  })
  assert.equal(controller.requestInstall(), false)
  assert.deepEqual(updater.installs, [])

  let exited = false
  assert.equal(controller.completeQuit(() => { exited = true }), 'install')
  assert.equal(exited, false)
  assert.deepEqual(updater.installs, [[false, true]])

  // Native quit/install owns the controller after this point; use a new session
  // to verify the no-update transition below.
  controller.start()
  updater.emit('update-not-available', { version: '1.2.2' })
  assert.deepEqual(states.at(-1), {
    status: 'idle', availableVersion: null, progressPercent: null, error: null,
  })
})

test('an install preflight replaces a stale staged update before restart', async () => {
  const { controller, updater, states } = setup()
  controller.start()
  updater.emit('update-downloaded', { version: '0.29.5' })
  updater.onCheck = () => {
    updater.emit('update-available', { version: '0.29.7' })
    updater.emit('update-downloaded', { version: '0.29.7' })
  }

  const prepared = await controller.prepareInstall()

  assert.equal(updater.checks, 1)
  assert.equal(states.at(-1)?.availableVersion, '0.29.7')
  assert.equal(states.at(-1)?.status, 'restarting')
  assert.equal(prepared, true)
})

test('an install preflight rejects a feed rollback below the staged version', async () => {
  const { controller, updater, states } = setup()
  controller.start()
  updater.emit('update-downloaded', { version: '0.29.7' })
  updater.onCheck = () => updater.emit('update-downloaded', { version: '0.29.5' })

  assert.equal(await controller.prepareInstall(), false)

  assert.equal(states.at(-1)?.status, 'error')
  assert.match(states.at(-1)?.error ?? '', /older than staged/)
})

test('graceful shutdown installs only an explicitly preflighted update', () => {
  const downloaded = setup()
  downloaded.controller.start()
  downloaded.updater.emit('update-downloaded', { version: '2.0.0' })
  let downloadedExit = false
  assert.equal(downloaded.controller.completeQuit(() => { downloadedExit = true }), 'exit')
  assert.equal(downloadedExit, true)
  assert.deepEqual(downloaded.updater.installs, [])

  const preflighted = setup()
  preflighted.controller.start()
  preflighted.updater.emit('update-downloaded', { version: '2.0.0' })
  assert.equal(preflighted.controller.requestInstall(), true)
  let preflightedExit = false
  assert.equal(preflighted.controller.completeQuit(() => { preflightedExit = true }), 'install')
  assert.equal(preflightedExit, false)
  assert.deepEqual(preflighted.updater.installs, [[false, true]])
  assert.equal(preflighted.updater.listenerCount('update-downloaded'), 1)

  const idle = setup()
  idle.controller.start()
  let idleExit = false
  assert.equal(idle.controller.completeQuit(() => { idleExit = true }), 'exit')
  assert.equal(idleExit, true)
  assert.deepEqual(idle.updater.installs, [])
  assert.equal(idle.updater.listenerCount('update-downloaded'), 0)
})

test('watchdog abandons a hung nested download so a retry can run without stale overwrite', async () => {
  const { controller, updater, scheduler, states } = setup()
  let resolveDownload!: () => void
  const downloadPromise = new Promise<void>(resolve => { resolveDownload = resolve })
  updater.nextResult = { downloadPromise }
  controller.start()

  const staleCheck = controller.checkForUpdates()
  await Promise.resolve()
  updater.emit('update-available', { version: '4.1.0' })
  const watchdog = scheduler.timeouts.filter(timer => timer.delayMs === UPDATE_DOWNLOAD_WATCHDOG_MS).at(-1)
  assert.ok(watchdog)
  watchdog.callback()
  assert.equal(states.at(-1)?.status, 'error')

  updater.nextResult = null
  await controller.checkForUpdates()
  assert.equal(updater.checks, 2)
  assert.equal(states.at(-1)?.status, 'idle')

  resolveDownload()
  await staleCheck
  assert.equal(states.at(-1)?.status, 'idle')
})

test('release comparison prevents a preflight downgrade', () => {
  assert.equal(compareReleaseVersions('0.29.7', '0.29.5'), 1)
  assert.equal(compareReleaseVersions('1.0.0', '1.0.0-rc.2'), 1)
  assert.equal(compareReleaseVersions('1.0.0-rc.10', '1.0.0-rc.2'), 1)
  assert.equal(compareReleaseVersions('0.29.7', '0.29.7'), 0)
  assert.equal(compareReleaseVersions('0.29.5', '0.29.7'), -1)
})
