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

test('updater publishes availability, progress, completion and installs only downloaded updates', () => {
  const { controller, updater, scheduler, states } = setup()
  controller.start()

  assert.equal(controller.installUpdate(), false)
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

  assert.equal(controller.installUpdate(), true)
  assert.deepEqual(updater.installs, [[false, true]])
  assert.equal(updater.listenerCount('update-available'), 0)

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
  assert.equal(downloaded.updater.listenerCount('update-downloaded'), 0)

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

  assert.equal(controller.installUpdate(), false)
  assert.equal(states.at(-1)?.status, 'error')
  assert.match(states.at(-1)?.error ?? '', /Could not restart.*installer busy.*Check for updates again/)
  assert.equal(updater.listenerCount('update-downloaded'), 1)

  updater.installError = null
  await controller.checkForUpdates()
  assert.equal(states.at(-1)?.status, 'idle')
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
