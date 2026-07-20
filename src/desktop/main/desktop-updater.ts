import type { DesktopUpdateState } from '../shared/desktop-contract'

export const INITIAL_UPDATE_DELAY_MS = 10_000
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000

type UpdaterListener = (...args: any[]) => void
type TimerHandle = ReturnType<typeof setTimeout>

/** Narrow electron-updater boundary so cadence and state are testable without Electron. */
export interface DesktopAutoUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: UpdaterListener): unknown
  removeListener(event: string, listener: UpdaterListener): unknown
}

export interface DesktopUpdaterScheduler {
  setTimeout(callback: () => void, delayMs: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
  setInterval(callback: () => void, delayMs: number): TimerHandle
  clearInterval(handle: TimerHandle): void
}

const systemScheduler: DesktopUpdaterScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: handle => clearInterval(handle),
}

export const disabledUpdateState = (): DesktopUpdateState => ({
  status: 'disabled',
  availableVersion: null,
  progressPercent: null,
  error: null,
})

export const idleUpdateState = (): DesktopUpdateState => ({
  status: 'idle',
  availableVersion: null,
  progressPercent: null,
  error: null,
})

export interface DesktopUpdaterControllerOptions {
  /** The caller owns packaged/release gating; false keeps the updater entirely dormant. */
  enabled: boolean
  updater: DesktopAutoUpdater
  onState(state: DesktopUpdateState): void
  scheduler?: DesktopUpdaterScheduler
  initialDelayMs?: number
  intervalMs?: number
  logger?: Pick<Console, 'warn'>
}

export class DesktopUpdaterController {
  private stateValue: DesktopUpdateState
  private readonly scheduler: DesktopUpdaterScheduler
  private readonly initialDelayMs: number
  private readonly intervalMs: number
  private readonly listeners: Array<[string, UpdaterListener]>
  private initialTimer: TimerHandle | null = null
  private intervalTimer: TimerHandle | null = null
  private inFlight: Promise<void> | null = null
  private started = false
  private generation = 0

  constructor(private readonly options: DesktopUpdaterControllerOptions) {
    this.scheduler = options.scheduler ?? systemScheduler
    this.initialDelayMs = options.initialDelayMs ?? INITIAL_UPDATE_DELAY_MS
    this.intervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS
    this.stateValue = options.enabled ? idleUpdateState() : disabledUpdateState()
    this.listeners = [
      ['checking-for-update', () => this.publish({ status: 'checking', progressPercent: null, error: null })],
      ['update-available', (info: { version?: unknown }) => this.publish({
        status: 'available',
        availableVersion: versionOf(info) ?? this.stateValue.availableVersion,
        progressPercent: null,
        error: null,
      })],
      ['update-not-available', () => this.publish(idleUpdateState())],
      ['download-progress', (progress: { percent?: unknown }) => this.publish({
        status: 'downloading',
        progressPercent: progressPercentOf(progress),
        error: null,
      })],
      ['update-downloaded', (info: { version?: unknown }) => this.publish({
        status: 'downloaded',
        availableVersion: versionOf(info) ?? this.stateValue.availableVersion,
        progressPercent: 100,
        error: null,
      })],
      ['error', (error: unknown) => this.fail(error)],
    ]
  }

  get state(): DesktopUpdateState { return this.stateValue }

  start(): void {
    if (this.started) return
    this.started = true
    this.generation += 1
    this.options.onState(this.stateValue)
    if (!this.options.enabled) return

    this.options.updater.autoDownload = true
    this.options.updater.autoInstallOnAppQuit = true
    for (const [event, listener] of this.listeners) this.options.updater.on(event, listener)

    this.initialTimer = this.scheduler.setTimeout(() => {
      this.initialTimer = null
      void this.checkForUpdates()
    }, this.initialDelayMs)
    this.initialTimer.unref?.()
    this.intervalTimer = this.scheduler.setInterval(() => void this.checkForUpdates(), this.intervalMs)
    this.intervalTimer.unref?.()
  }

  async checkForUpdates(): Promise<void> {
    if (!this.started || !this.options.enabled) throw new Error('Updates are unavailable in this build')
    // Preserve the actionable ready-to-install state and never start a second
    // network cycle while the current update is still downloading.
    if (this.stateValue.status === 'downloading' || this.stateValue.status === 'downloaded') return
    if (this.inFlight) return this.inFlight
    const generation = this.generation
    this.publish({ status: 'checking', progressPercent: null, error: null })
    const check = (async () => {
      try {
        await this.options.updater.checkForUpdates()
      } catch (error) {
        if (this.started && this.generation === generation) this.fail(error)
      } finally {
        if (this.generation === generation) this.inFlight = null
      }
    })()
    this.inFlight = check
    return check
  }

  installUpdate(): boolean {
    if (!this.started || !this.options.enabled || this.stateValue.status !== 'downloaded') return false
    // The native installer owns the following quit. Stop our timers/listeners first so
    // the asynchronous daemon-shutdown interception cannot leave updater work behind.
    this.stop()
    this.options.updater.quitAndInstall(false, true)
    return true
  }

  /** Complete Tokmon's intercepted quit after daemon cleanup has finished. */
  completeQuit(exitWithoutUpdate: () => void): 'install' | 'exit' {
    if (this.installUpdate()) return 'install'
    this.stop()
    exitWithoutUpdate()
    return 'exit'
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.generation += 1
    if (this.initialTimer) this.scheduler.clearTimeout(this.initialTimer)
    if (this.intervalTimer) this.scheduler.clearInterval(this.intervalTimer)
    this.initialTimer = null
    this.intervalTimer = null
    this.inFlight = null
    if (this.options.enabled) {
      for (const [event, listener] of this.listeners) this.options.updater.removeListener(event, listener)
    }
  }

  private publish(patch: DesktopUpdateState | Partial<DesktopUpdateState>): void {
    if (!this.started) return
    this.stateValue = { ...this.stateValue, ...patch }
    this.options.onState(this.stateValue)
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (this.stateValue.status === 'error' && this.stateValue.error === message) return
    this.options.logger?.warn('[tokmon] update check failed', message)
    this.publish({ status: 'error', progressPercent: null, error: message })
  }
}

function versionOf(info: { version?: unknown } | null | undefined): string | null {
  return typeof info?.version === 'string' && info.version.length > 0 ? info.version : null
}

function progressPercentOf(progress: { percent?: unknown } | null | undefined): number | null {
  if (typeof progress?.percent !== 'number' || !Number.isFinite(progress.percent)) return null
  return Math.max(0, Math.min(100, progress.percent))
}
