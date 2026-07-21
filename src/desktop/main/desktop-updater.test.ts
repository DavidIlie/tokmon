import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { DesktopUpdateState } from '../shared/desktop-contract'
import {
  DesktopUpdaterController,
  INITIAL_UPDATE_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_DOWNLOAD_STALLED_MESSAGE,
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

function setup(enabled = true, supported = true, requireNativeReady = false) {
  const updater = new FakeUpdater()
  const scheduler = new FakeScheduler()
  const states: DesktopUpdateState[] = []
  const warnings: unknown[][] = []
  const controller = new DesktopUpdaterController({
    enabled,
    supported,
    requireNativeReady,
    updater,
    scheduler,
    onState: state => states.push({ ...state }),
    logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
  })
  return { controller, updater, scheduler, states, warnings }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

test('release updater configures automatic install and schedules launch plus hourly checks', async () => {
  const { controller, updater, scheduler, states } = setup()

  controller.start()

  assert.equal(updater.autoDownload, true)
  assert.equal(updater.autoInstallOnAppQuit, true)
  assert.equal(scheduler.timeouts[0]?.delayMs, INITIAL_UPDATE_DELAY_MS)
  assert.equal(scheduler.intervals[0]?.delayMs, UPDATE_CHECK_INTERVAL_MS)
  assert.equal(states.at(-1)?.status, 'idle')

  scheduler.timeouts[0]!.callback()
  await flushAsyncWork()
  assert.equal(updater.checks, 1)
  assert.equal(states.at(-1)?.status, 'idle')

  scheduler.intervals[0]!.callback()
  await flushAsyncWork()
  assert.equal(updater.checks, 2)
  assert.equal(states.at(-1)?.status, 'idle')
})

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

test('graceful shutdown installs a downloaded update after cleanup and otherwise exits', () => {
  const downloaded = setup()
  downloaded.controller.start()
  downloaded.updater.emit('update-downloaded', { version: '2.0.0' })
  let downloadedExit = false
  assert.equal(downloaded.controller.completeQuit(() => { downloadedExit = true }), 'install')
  assert.equal(downloadedExit, false)
  assert.deepEqual(downloaded.updater.installs, [[false, true]])
  assert.equal(downloaded.updater.listenerCount('update-downloaded'), 1)

  const idle = setup()
  idle.controller.start()
  let idleExit = false
  assert.equal(idle.controller.completeQuit(() => { idleExit = true }), 'exit')
  assert.equal(idleExit, true)
  assert.deepEqual(idle.updater.installs, [])
  assert.equal(idle.updater.listenerCount('update-downloaded'), 0)
})

test('manual checks are de-duplicated, null results return idle, and failures can be retried', async () => {
  const { controller, updater, states, warnings } = setup()
  let resolveCheck!: () => void
  updater.pendingCheck = new Promise<void>(resolve => { resolveCheck = resolve })
  controller.start()

  const first = controller.checkForUpdates()
  const second = controller.checkForUpdates()
  assert.equal(updater.checks, 1)
  assert.equal(states.at(-1)?.status, 'checking')
  resolveCheck()
  await Promise.all([first, second])
  assert.equal(states.at(-1)?.status, 'idle')

  updater.pendingCheck = null
  updater.nextError = new Error('feed unavailable')
  await controller.checkForUpdates()
  assert.equal(states.at(-1)?.status, 'error')
  assert.equal(states.at(-1)?.error, 'feed unavailable')
  assert.equal(warnings.length, 1)

  updater.nextError = null
  await controller.checkForUpdates()
  assert.equal(states.at(-1)?.status, 'idle')
  assert.equal(states.at(-1)?.error, null)
})

test('awaits the updater download promise and exposes nested download failures', async () => {
  const { controller, updater, states } = setup()
  controller.start()
  updater.nextResult = { downloadPromise: Promise.reject(new Error('artifact download failed')) }

  await controller.checkForUpdates()

  assert.equal(states.at(-1)?.status, 'error')
  assert.equal(states.at(-1)?.error, 'artifact download failed')
})

test('does not publish downloaded until the nested updater download promise settles', async () => {
  const { controller, updater, states } = setup()
  let finishStaging!: () => void
  updater.nextResult = { downloadPromise: new Promise<void>(resolve => { finishStaging = resolve }) }
  updater.onCheck = () => {
    updater.emit('update-available', { version: '3.1.0' })
    updater.emit('update-downloaded', { version: '3.1.0' })
  }
  controller.start()

  const check = controller.checkForUpdates()
  await Promise.resolve()
  assert.equal(states.at(-1)?.status, 'available')
  assert.equal(controller.requestInstall(), false)

  finishStaging()
  await check
  assert.equal(states.at(-1)?.status, 'downloaded')
  assert.equal(controller.requestInstall(), true)
})

test('macOS readiness waits for both the updater promise and native staging in either order', async () => {
  const nativeLast = setup(true, true, true)
  let finishDownload!: () => void
  nativeLast.updater.nextResult = { downloadPromise: new Promise<void>(resolve => { finishDownload = resolve }) }
  nativeLast.updater.onCheck = () => {
    nativeLast.updater.emit('update-available', { version: '3.2.0' })
    nativeLast.updater.emit('update-downloaded', { version: '3.2.0' })
  }
  nativeLast.controller.start()

  const firstCheck = nativeLast.controller.checkForUpdates()
  await Promise.resolve()
  finishDownload()
  await firstCheck
  assert.notEqual(nativeLast.states.at(-1)?.status, 'downloaded')
  assert.equal(nativeLast.controller.requestInstall(), false)
  nativeLast.controller.markNativeReady()
  assert.equal(nativeLast.states.at(-1)?.status, 'downloaded')

  const nativeFirst = setup(true, true, true)
  let finishStagingDownload!: () => void
  nativeFirst.updater.nextResult = { downloadPromise: new Promise<void>(resolve => { finishStagingDownload = resolve }) }
  nativeFirst.updater.onCheck = () => {
    nativeFirst.updater.emit('update-available', { version: '3.3.0' })
    nativeFirst.updater.emit('update-downloaded', { version: '3.3.0' })
  }
  nativeFirst.controller.start()

  const secondCheck = nativeFirst.controller.checkForUpdates()
  await Promise.resolve()
  nativeFirst.controller.markNativeReady()
  assert.notEqual(nativeFirst.states.at(-1)?.status, 'downloaded')
  finishStagingDownload()
  await secondCheck
  assert.equal(nativeFirst.states.at(-1)?.status, 'downloaded')
})

test('available and downloading states block duplicate checks until progress completes or errors', async () => {
  const { controller, updater } = setup()
  controller.start()

  updater.emit('update-available', { version: '3.0.0' })
  await controller.checkForUpdates()
  assert.equal(updater.checks, 0)

  updater.emit('download-progress', { percent: 10 })
  await controller.checkForUpdates()
  assert.equal(updater.checks, 0)

  updater.emit('error', new Error('download interrupted'))
  await controller.checkForUpdates()
  assert.equal(updater.checks, 1)
})

test('a synchronous updater error cannot leave a stale de-duplication lock', async () => {
  const { controller, updater, states } = setup()
  controller.start()
  updater.onCheck = () => updater.emit('error', new Error('synchronous updater failure'))

  await controller.checkForUpdates()
  assert.equal(states.at(-1)?.status, 'error')

  updater.onCheck = null
  await controller.checkForUpdates()
  assert.equal(updater.checks, 2)
  assert.equal(states.at(-1)?.status, 'idle')
})

test('download watchdog resets on progress, fails with recovery guidance, and allows hourly retry', async () => {
  const { controller, updater, scheduler, states } = setup()
  controller.start()

  updater.emit('update-available', { version: '4.0.0' })
  const availableWatchdog = scheduler.timeouts.find(timer => timer.delayMs === UPDATE_DOWNLOAD_WATCHDOG_MS)
  assert.ok(availableWatchdog)

  updater.emit('download-progress', { percent: 12 })
  assert.ok(scheduler.clearedTimeouts.includes(availableWatchdog.handle))
  const watchdogs = scheduler.timeouts.filter(timer => timer.delayMs === UPDATE_DOWNLOAD_WATCHDOG_MS)
  const progressWatchdog = watchdogs.at(-1)
  assert.ok(progressWatchdog)

  progressWatchdog.callback()
  assert.equal(states.at(-1)?.status, 'error')
  assert.equal(states.at(-1)?.error, UPDATE_DOWNLOAD_STALLED_MESSAGE)

  scheduler.intervals[0]!.callback()
  await flushAsyncWork()
  assert.equal(updater.checks, 1)
  assert.equal(states.at(-1)?.status, 'idle')
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

test('synchronous install failure stays operational and publishes an actionable error', async () => {
  const { controller, updater, states } = setup()
  controller.start()
  updater.emit('update-downloaded', { version: '5.0.0' })
  updater.installError = new Error('installer busy')

  assert.equal(controller.requestInstall(), true)
  assert.equal(controller.completeQuit(() => {}), 'error')
  assert.equal(states.at(-1)?.status, 'error')
  assert.match(states.at(-1)?.error ?? '', /Could not restart.*installer busy.*Check for updates again/)
  assert.equal(updater.listenerCount('update-downloaded'), 1)

  updater.installError = null
  await controller.checkForUpdates()
  assert.equal(states.at(-1)?.status, 'idle')
})

test('updater errors emitted during or after native handoff remain observable', () => {
  const synchronous = setup()
  synchronous.controller.start()
  synchronous.updater.emit('update-downloaded', { version: '5.1.0' })
  synchronous.updater.onInstall = () => synchronous.updater.emit('error', new Error('native handoff rejected'))
  assert.equal(synchronous.controller.requestInstall(), true)
  assert.equal(synchronous.controller.completeQuit(() => {}), 'error')
  assert.equal(synchronous.states.at(-1)?.status, 'error')

  const asynchronous = setup()
  asynchronous.controller.start()
  asynchronous.updater.emit('update-downloaded', { version: '5.2.0' })
  assert.equal(asynchronous.controller.requestInstall(), true)
  assert.equal(asynchronous.controller.completeQuit(() => {}), 'install')
  asynchronous.updater.emit('error', new Error('native handoff stalled'))
  assert.equal(asynchronous.states.at(-1)?.status, 'error')
})

test('graceful update quit remains operational when native install throws', () => {
  const { controller, updater } = setup()
  controller.start()
  updater.emit('update-downloaded', { version: '5.0.0' })
  updater.installError = new Error('installer unavailable')
  let exited = false

  assert.equal(controller.completeQuit(() => { exited = true }), 'error')
  assert.equal(exited, false)
  assert.equal(updater.listenerCount('update-downloaded'), 1)
})

test('disabled builds stay dormant and cleanup removes timers and event listeners', async () => {
  const disabled = setup(false)
  disabled.controller.start()
  assert.equal(disabled.states.at(-1)?.status, 'disabled')
  assert.equal(disabled.scheduler.timeouts.length, 0)
  assert.equal(disabled.updater.listenerCount('update-available'), 0)
  await assert.rejects(disabled.controller.checkForUpdates(), /disabled/)

  const unsupported = setup(true, false)
  unsupported.controller.start()
  assert.equal(unsupported.states.at(-1)?.status, 'unsupported')
  assert.equal(unsupported.scheduler.timeouts.length, 0)
  assert.equal(unsupported.updater.listenerCount('update-available'), 0)
  await assert.rejects(unsupported.controller.checkForUpdates(), /unsupported/)

  const active = setup()
  active.controller.start()
  assert.equal(active.updater.listenerCount('update-available'), 1)
  active.controller.stop()
  assert.equal(active.scheduler.clearedTimeouts.length, 1)
  assert.equal(active.scheduler.clearedIntervals.length, 1)
  assert.equal(active.updater.listenerCount('update-available'), 0)
  const stateCount = active.states.length
  active.updater.emit('update-available', { version: '9.9.9' })
  assert.equal(active.states.length, stateCount)
  await assert.rejects(active.controller.checkForUpdates(), /disabled/)
})

test('stop clears an armed download watchdog', () => {
  const { controller, updater, scheduler } = setup()
  controller.start()
  updater.emit('update-available', { version: '6.0.0' })
  const watchdog = scheduler.timeouts.find(timer => timer.delayMs === UPDATE_DOWNLOAD_WATCHDOG_MS)
  assert.ok(watchdog)

  controller.stop()

  assert.ok(scheduler.clearedTimeouts.includes(watchdog.handle))
})
