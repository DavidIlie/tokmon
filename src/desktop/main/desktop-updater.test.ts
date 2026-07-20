import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { DesktopUpdateState } from '../shared/desktop-contract'
import {
  DesktopUpdaterController,
  INITIAL_UPDATE_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
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

  async checkForUpdates(): Promise<unknown> {
    this.checks += 1
    if (this.nextError) throw this.nextError
    if (this.pendingCheck) return this.pendingCheck
    return null
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
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

function setup(enabled = true) {
  const updater = new FakeUpdater()
  const scheduler = new FakeScheduler()
  const states: DesktopUpdateState[] = []
  const warnings: unknown[][] = []
  const controller = new DesktopUpdaterController({
    enabled,
    updater,
    scheduler,
    onState: state => states.push({ ...state }),
    logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
  })
  return { controller, updater, scheduler, states, warnings }
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
  await Promise.resolve()
  assert.equal(updater.checks, 1)
  assert.equal(states.at(-1)?.status, 'checking')

  scheduler.intervals[0]!.callback()
  await Promise.resolve()
  assert.equal(updater.checks, 2)
})

test('updater publishes availability, progress, completion and installs only downloaded updates', () => {
  const { controller, updater, states } = setup()
  controller.start()

  assert.equal(controller.installUpdate(), false)
  updater.emit('update-available', { version: '1.2.3' })
  assert.deepEqual(states.at(-1), {
    status: 'available', availableVersion: '1.2.3', progressPercent: null, error: null,
  })
  updater.emit('download-progress', { percent: 42.25 })
  assert.equal(states.at(-1)?.status, 'downloading')
  assert.equal(states.at(-1)?.progressPercent, 42.25)
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

test('manual checks are de-duplicated and failures become visible state', async () => {
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

  updater.pendingCheck = null
  updater.nextError = new Error('feed unavailable')
  await controller.checkForUpdates()
  assert.equal(states.at(-1)?.status, 'error')
  assert.equal(states.at(-1)?.error, 'feed unavailable')
  assert.equal(warnings.length, 1)
})

test('disabled builds stay dormant and cleanup removes timers and event listeners', async () => {
  const disabled = setup(false)
  disabled.controller.start()
  assert.equal(disabled.states.at(-1)?.status, 'disabled')
  assert.equal(disabled.scheduler.timeouts.length, 0)
  assert.equal(disabled.updater.listenerCount('update-available'), 0)
  await assert.rejects(disabled.controller.checkForUpdates(), /unavailable/)

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
  await assert.rejects(active.controller.checkForUpdates(), /unavailable/)
})
