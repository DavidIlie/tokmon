import type { DesktopUpdateState } from '../shared/desktop-contract'

export const INITIAL_UPDATE_DELAY_MS = 10_000
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000
export const UPDATE_DOWNLOAD_WATCHDOG_MS = 10 * 60 * 1_000
export const UPDATE_CHECK_WATCHDOG_MS = 3 * 60 * 1_000
export const UPDATE_DOWNLOAD_STALLED_MESSAGE = 'Update download made no progress for 10 minutes. Check your connection and retry, or choose Download Latest for the installer.'
export const UPDATE_CHECK_STALLED_MESSAGE = 'The update check did not respond for 3 minutes. Check your connection, then choose Check for Updates to retry.'

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

export const unsupportedUpdateState = (): DesktopUpdateState => ({
  status: 'unsupported',
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
  /** Platform/provider capability. Unsupported release builds remain distinct from disabled dev builds. */
  supported?: boolean
  updater: DesktopAutoUpdater
  onState(state: DesktopUpdateState): void
  scheduler?: DesktopUpdaterScheduler
  initialDelayMs?: number
  intervalMs?: number
  downloadWatchdogMs?: number
  logger?: Pick<Console, 'warn'>
}

export class DesktopUpdaterController {
  private stateValue: DesktopUpdateState
  private readonly scheduler: DesktopUpdaterScheduler
  private readonly initialDelayMs: number
  private readonly intervalMs: number
  private readonly downloadWatchdogMs: number
  private readonly listeners: Array<[string, UpdaterListener]>
  private initialTimer: TimerHandle | null = null
  private intervalTimer: TimerHandle | null = null
  private downloadWatchdogTimer: TimerHandle | null = null
  private inFlight: Promise<void> | null = null
  private started = false
  private generation = 0
  private checkAttempt = 0
  private deferredDownloadAttempt: number | null = null
  private deferredDownloadedInfo: { version?: unknown } | null = null
  private deferredDownloadSettled = false
  private readyBeforeCheck: DesktopUpdateState | null = null
  private installPreparation: Promise<boolean> | null = null
  private activeCancellationToken: UpdateCancellationToken | null = null
  private readonly terminalWaiters = new Set<(state: DesktopUpdateState | null) => void>()

  constructor(private readonly options: DesktopUpdaterControllerOptions) {
    this.scheduler = options.scheduler ?? systemScheduler
    this.initialDelayMs = options.initialDelayMs ?? INITIAL_UPDATE_DELAY_MS
    this.intervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS
    this.downloadWatchdogMs = options.downloadWatchdogMs ?? UPDATE_DOWNLOAD_WATCHDOG_MS
    this.stateValue = !options.enabled
      ? disabledUpdateState()
      : this.supported
        ? idleUpdateState()
        : unsupportedUpdateState()
    this.listeners = [
      ['checking-for-update', () => this.publish({ status: 'checking', progressPercent: null, error: null })],
      ['update-available', (info: { version?: unknown }) => {
        this.publish({
          status: 'available',
          availableVersion: versionOf(info) ?? this.stateValue.availableVersion,
          progressPercent: null,
          error: null,
        })
      }],
      ['update-not-available', () => {
        const readyBeforeCheck = this.readyBeforeCheck
        this.readyBeforeCheck = null
        this.abandonCheck()
        this.publish(readyBeforeCheck ?? idleUpdateState())
      }],
      ['download-progress', (progress: { percent?: unknown }) => this.publish({
        status: 'downloading',
        progressPercent: progressPercentOf(progress),
        error: null,
      })],
      ['update-downloaded', (info: { version?: unknown }) => {
        // MacUpdater can emit this public event before its nested downloadPromise
        // settles. Native Squirrel staging intentionally starts later, inside
        // quitAndInstall(), when autoInstallOnAppQuit is disabled.
        if (this.deferredDownloadAttempt === null) this.deferredDownloadSettled = true
        this.deferredDownloadedInfo = info
        this.publishDownloadedIfReady()
      }],
      ['error', (error: unknown) => {
        this.abandonCheck()
        this.fail(error)
      }],
    ]
  }

  get state(): DesktopUpdateState { return this.stateValue }

  private get supported(): boolean { return this.options.supported ?? true }

  private get active(): boolean { return this.options.enabled && this.supported }

  start(): void {
    if (this.started) return
    this.started = true
    this.generation += 1
    this.options.onState(this.stateValue)
    if (!this.active) return

    this.options.updater.autoDownload = true
    // Installation is explicit: prepareInstall() re-checks the feed immediately
    // before restart. Letting electron-updater install on an unrelated app quit
    // would bypass that freshness guarantee.
    this.options.updater.autoInstallOnAppQuit = false
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
    return this.runCheck()
  }

  /**
   * Re-check the feed before accepting a staged update. If a newer release
   * appeared since the original download, autoDownload replaces the staged
   * payload and this waits for its verified updater download to settle.
   */
  async prepareInstall(): Promise<boolean> {
    if (!this.started || !this.options.enabled) throw new Error('Updates are disabled in this build')
    if (!this.supported) throw new Error('Updates are unsupported on this platform')
    if (this.installPreparation) return this.installPreparation
    if (this.stateValue.status !== 'downloaded') return false

    const stagedVersion = this.stateValue.availableVersion
    const preparation = (async () => {
      this.readyBeforeCheck = { ...this.stateValue }
      await this.runCheck(true)
      await this.waitForInstallCandidate()
      if (this.stateValue.status !== 'downloaded') return false
      const candidateVersion = this.stateValue.availableVersion
      if (stagedVersion && candidateVersion && compareReleaseVersions(candidateVersion, stagedVersion) < 0) {
        this.readyBeforeCheck = null
        this.fail(new Error(
          `Update feed returned ${candidateVersion}, older than staged ${stagedVersion}. Check for updates again before installing.`,
        ))
        return false
      }
      return this.requestInstall()
    })()
    this.installPreparation = preparation
    try {
      return await preparation
    } finally {
      if (this.installPreparation === preparation) this.installPreparation = null
    }
  }

  private async runCheck(allowDownloaded = false): Promise<void> {
    if (!this.started || !this.options.enabled) throw new Error('Updates are disabled in this build')
    if (!this.supported) throw new Error('Updates are unsupported on this platform')
    // Preserve the actionable ready-to-install state and never start a second
    // network cycle while the current update is still downloading.
    if (
      this.stateValue.status === 'available'
      || this.stateValue.status === 'downloading'
      || (this.stateValue.status === 'downloaded' && !allowDownloaded)
      || this.stateValue.status === 'restarting'
    ) return
    if (this.inFlight) return this.inFlight
    const generation = this.generation
    const attempt = ++this.checkAttempt
    this.deferredDownloadAttempt = attempt
    this.deferredDownloadedInfo = null
    this.deferredDownloadSettled = false
    this.publish({ status: 'checking', progressPercent: null, error: null })
    const check = (async () => {
      try {
        const result = await this.options.updater.checkForUpdates()
        this.activeCancellationToken = cancellationTokenOf(result)
        const downloadPromise = downloadPromiseOf(result)
        if (downloadPromise) await downloadPromise
        if (this.isCurrentCheck(generation, attempt)) {
          this.deferredDownloadSettled = true
          this.publishDownloadedIfReady()
        }
        if (this.isCurrentCheck(generation, attempt) && this.stateValue.status === 'checking') {
          const readyBeforeCheck = this.readyBeforeCheck
          this.readyBeforeCheck = null
          this.publish(readyBeforeCheck ?? idleUpdateState())
          this.clearDeferredDownload(attempt)
        }
      } catch (error) {
        if (this.isCurrentCheck(generation, attempt)) {
          const readyBeforeCheck = this.readyBeforeCheck
          this.readyBeforeCheck = null
          this.clearDeferredDownload(attempt)
          // A prepareInstall preflight that fails on a transient network error
          // must not destroy the fully staged download it was re-validating —
          // offline users could no longer install what they already have.
          if (readyBeforeCheck && allowDownloaded) this.publish(readyBeforeCheck)
          else this.fail(error)
        }
      } finally {
        if (this.isCurrentCheck(generation, attempt)) {
          this.inFlight = null
        }
      }
    })()
    if (this.isCurrentCheck(generation, attempt)) this.inFlight = check
    return check
  }

  /** Stage one visible, idempotent restart request. Main owns cleanup and app.quit(). */
  requestInstall(): boolean {
    if (!this.started || !this.active || this.stateValue.status !== 'downloaded') return false
    this.publish({ status: 'restarting', progressPercent: 100, error: null })
    return true
  }

  /** Report a native handoff that never reached will-quit so the app can recover. */
  failInstallHandoff(message: string): void {
    if (!this.started || this.stateValue.status !== 'restarting') return
    this.fail(new Error(message))
  }

  private commitInstall(): boolean {
    if (!this.started || !this.active || this.stateValue.status !== 'restarting') return false
    try {
      // Keep listeners alive until will-quit. electron-updater can emit an error
      // synchronously instead of throwing, and asynchronous native failures must
      // remain observable while the app is still alive.
      this.options.updater.quitAndInstall(false, true)
      return this.stateValue.status === 'restarting'
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.fail(new Error(`Could not restart to install the update: ${detail}. Check for updates again, or quit Tokmon and reopen it.`))
      return false
    }
  }

  /** Complete Tokmon's intercepted quit after daemon cleanup has finished. */
  completeQuit(exitWithoutUpdate: () => void): 'install' | 'exit' | 'error' {
    const wasReadyToInstall = this.stateValue.status === 'restarting'
    if (this.commitInstall()) return 'install'
    if (wasReadyToInstall && this.stateValue.status === 'error') return 'error'
    this.stop()
    exitWithoutUpdate()
    return 'exit'
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.generation += 1
    this.checkAttempt += 1
    if (this.initialTimer) this.scheduler.clearTimeout(this.initialTimer)
    if (this.intervalTimer) this.scheduler.clearInterval(this.intervalTimer)
    this.clearDownloadWatchdog()
    this.initialTimer = null
    this.intervalTimer = null
    this.inFlight = null
    this.installPreparation = null
    this.activeCancellationToken = null
    this.deferredDownloadAttempt = null
    this.deferredDownloadedInfo = null
    this.deferredDownloadSettled = false
    this.readyBeforeCheck = null
    for (const waiter of this.terminalWaiters) waiter(null)
    this.terminalWaiters.clear()
    if (this.active) {
      for (const [event, listener] of this.listeners) this.options.updater.removeListener(event, listener)
    }
  }

  private publish(patch: DesktopUpdateState | Partial<DesktopUpdateState>): void {
    if (!this.started) return
    this.stateValue = { ...this.stateValue, ...patch }
    // 'checking' needs a watchdog too: a hung feed request otherwise leaves the
    // updater in 'checking' forever — runCheck() refuses to start a new cycle
    // while one is in flight, so the updater is bricked until app restart.
    if (this.stateValue.status === 'available' || this.stateValue.status === 'downloading') {
      this.armWatchdog(this.downloadWatchdogMs, UPDATE_DOWNLOAD_STALLED_MESSAGE)
    } else if (this.stateValue.status === 'checking') {
      this.armWatchdog(UPDATE_CHECK_WATCHDOG_MS, UPDATE_CHECK_STALLED_MESSAGE)
    } else {
      this.clearDownloadWatchdog()
    }
    this.options.onState(this.stateValue)
    for (const waiter of this.terminalWaiters) waiter(this.stateValue)
  }

  private armWatchdog(delayMs: number, message: string): void {
    this.clearDownloadWatchdog()
    const guarded = this.stateValue.status
    this.downloadWatchdogTimer = this.scheduler.setTimeout(() => {
      this.downloadWatchdogTimer = null
      if (!this.started) return
      if (this.stateValue.status !== guarded) return
      this.abandonCheck()
      this.fail(new Error(message))
    }, delayMs)
    this.downloadWatchdogTimer.unref?.()
  }

  private clearDownloadWatchdog(): void {
    if (!this.downloadWatchdogTimer) return
    this.scheduler.clearTimeout(this.downloadWatchdogTimer)
    this.downloadWatchdogTimer = null
  }

  private abandonCheck(): void {
    this.checkAttempt += 1
    this.inFlight = null
    this.deferredDownloadAttempt = null
    this.deferredDownloadedInfo = null
    this.deferredDownloadSettled = false
    this.readyBeforeCheck = null
    // Abandoning without cancelling leaves electron-updater awaiting the same
    // dead transfer; the next check would silently re-join it and stall again.
    const token = this.activeCancellationToken
    this.activeCancellationToken = null
    if (token) try { token.cancel() } catch {}
  }

  private publishDownloadedIfReady(): void {
    const info = this.deferredDownloadedInfo
    if (!info || !this.deferredDownloadSettled) return
    this.deferredDownloadAttempt = null
    this.deferredDownloadedInfo = null
    this.deferredDownloadSettled = false
    this.readyBeforeCheck = null
    this.publish({
      status: 'downloaded',
      availableVersion: versionOf(info) ?? this.stateValue.availableVersion,
      progressPercent: 100,
      error: null,
    })
  }

  private clearDeferredDownload(attempt: number): void {
    if (this.deferredDownloadAttempt !== attempt) return
    this.deferredDownloadAttempt = null
    this.deferredDownloadedInfo = null
    this.deferredDownloadSettled = false
  }

  private isCurrentCheck(generation: number, attempt: number): boolean {
    return this.started && this.generation === generation && this.checkAttempt === attempt
  }

  private waitForInstallCandidate(): Promise<void> {
    if (!isUpdateWorkInProgress(this.stateValue.status)) return Promise.resolve()
    return new Promise(resolve => {
      const waiter = (state: DesktopUpdateState | null) => {
        if (state && isUpdateWorkInProgress(state.status)) return
        this.terminalWaiters.delete(waiter)
        resolve()
      }
      this.terminalWaiters.add(waiter)
    })
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

function downloadPromiseOf(result: unknown): Promise<unknown> | null {
  if (typeof result !== 'object' || result === null || !('downloadPromise' in result)) return null
  const downloadPromise = (result as { downloadPromise?: unknown }).downloadPromise
  return isPromiseLike(downloadPromise) ? Promise.resolve(downloadPromise) : null
}

interface UpdateCancellationToken { cancel(): void }

function cancellationTokenOf(result: unknown): UpdateCancellationToken | null {
  if (typeof result !== 'object' || result === null || !('cancellationToken' in result)) return null
  const token = (result as { cancellationToken?: unknown }).cancellationToken
  return typeof token === 'object' && token !== null && typeof (token as { cancel?: unknown }).cancel === 'function'
    ? token as UpdateCancellationToken
    : null
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false
}

function isUpdateWorkInProgress(status: DesktopUpdateState['status']): boolean {
  return status === 'checking' || status === 'available' || status === 'downloading'
}

/** SemVer release precedence for the production x.y.z versions in update feeds. */
export function compareReleaseVersions(left: string, right: string): number {
  const parse = (value: string): [number, number, number, string | null] | null => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
    if (!match) return null
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null]
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return left === right ? 0 : -1
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1
  }
  if (a[3] === b[3]) return 0
  if (a[3] === null) return 1
  if (b[3] === null) return -1
  return a[3].localeCompare(b[3], 'en', { numeric: true })
}
