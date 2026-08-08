import { app, Menu, nativeImage, nativeTheme, powerMonitor, screen, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import updaterPackage from 'electron-updater'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { withTimeout } from '../../async'
import { DEFAULT_APPEARANCE, resolveTheme } from '../../theme'
import { usageFromHeadroom } from '../../usage-semantics'
import { formatCompactTokens } from '../../shared/format'
import { createDaemonRpcClient, type DaemonRpcClient } from '../../client/daemon-rpc-client'
import { acquireOrAttachDaemon, type DaemonController } from '../../web/daemon-controller'
import { DesktopStateStore, trayStripPayloadMatchesState } from './desktop-state'
import { DesktopUpdaterController, type DesktopAutoUpdater } from './desktop-updater'
import { desktopIdentity, desktopUserDataPath, resolveDesktopChannel } from './desktop-runtime'
import { readDesktopLoginItem, setDesktopLoginItem } from './desktop-login-item'
import { registerDesktopIpc } from './ipc-bridge'
import { createPopoverWindow } from './popover-window'
import { effectiveSystemMode, electronThemeSource } from './native-theme'
import { activeAccountIds, promotionAccounts, tightestQuota } from './presentation'
import { selectPromotedAccounts, type PromotionState } from './promotion'
import { createTrayIcon } from './tray-icon'
import { TrayStripLifecycle } from './tray-strip-lifecycle'
import { disconnectedMenuBarTitle, menuBarTitle } from './tray-presentation'
import { accountIdentity } from '../shared/privacy'
import {
  percentText,
  billingObservedAt,
  billingStaleAfterMs,
  providerRepresentative,
  providerTodayTokens,
  resetLabel,
  resolveProviderPins,
  severity,
  severityTag,
  staleAgeLabel,
} from '../shared/presentation'
import type { HeadroomView, WebAccount, WebSnapshot } from '../../web/contract'
import { DESKTOP_DOWNLOAD_URL, type DesktopUpdateState } from '../shared/desktop-contract'

/** Unified critical band (≤10%), shared by strip, gauge, tooltip and popover. */
function isCritical(remaining: number | null): boolean {
  return severity(remaining) === 'crit'
}

function updateReady(update: DesktopUpdateState): boolean {
  return update.status === 'downloaded'
}

function updateTooltipLine(appName: string, update: DesktopUpdateState): string | null {
  if (update.status === 'restarting') {
    const version = update.availableVersion ? ` ${update.availableVersion}` : ''
    return `${appName} is restarting to install${version}…`
  }
  if (!updateReady(update)) return null
  const version = update.availableVersion ? ` ${update.availableVersion}` : ''
  return `${appName}${version} is ready to install — right-click and choose “Restart to Install”.`
}

/** Honest per-provider tooltip line: one real window of one real account, in words. */
function providerTooltipLine(
  providerName: string,
  accounts: readonly WebAccount[],
  privacy: boolean,
  snapshot: WebSnapshot,
  activeTimeoutMin: number,
  now: number,
  headroom?: HeadroomView,
): string {
  if (headroom) {
    if (headroom.value === null) return `${providerName} — no usage data yet`
    const usage = usageFromHeadroom(headroom.value)!
    const account = accounts.find(candidate => candidate.id === headroom.representativeAccountId)
    const identity = account && accounts.length > 1 ? ` · ${accountIdentity(account, privacy)}` : ''
    return `${providerName} — Usage ${percentText(usage)}${identity}`
  }
  const rep = providerRepresentative(accounts, activeTimeoutMin, now)
  if (rep.noData || !rep.quota || rep.account === null) return `${providerName} — no usage data yet`
  const multi = accounts.length > 1
  const identity = accountIdentity(rep.account, privacy)
  const value = percentText(rep.quota.used!)
  const word = severityTag(severity(rep.quota.remaining))
  const reset = resetLabel(rep.quota.resetsAt, now)
  const observedAt = billingObservedAt(rep.account)
  const stale = observedAt !== null && now - observedAt > billingStaleAfterMs(snapshot)
  let line = `${providerName} — ${multi ? `${identity} · ` : ''}${rep.quota.label} ${value} used`
  if (word) line += `, ${word}`
  if (reset) line += `, ${reset}`
  if (multi && rep.dataCount > 1 && rep.runwayPct !== null) {
    line += ` · ${rep.dataCount} accounts, lowest account usage ${percentText(100 - rep.runwayPct)}`
  }
  if (stale) line += ` · ${staleAgeLabel(rep.account, now).toLowerCase()}`
  return line
}

let daemon: DaemonController | null = null
let rpc: DaemonRpcClient | null = null
let closing = false
let nativeUpdateQuitAllowed = false
// Module-scope anchor: a Tray held only by a function scope is eligible for GC,
// and a collected Tray silently disappears from the menu bar — the classic
// Electron "app just vanished" failure for tray-only apps.
let trayRef: Tray | null = null
const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
const { autoUpdater } = updaterPackage
const UPDATE_INSTALL_HANDOFF_TIMEOUT_MS = 2 * 60 * 1_000
// Stable macOS/Windows identity keeps the user's chosen status-item position
// across launches instead of registering a brand-new item every time.
const RELEASE_TRAY_GUID = '6515998a-4215-4ba2-b9be-c1f2fe105d2a'
const DEV_TRAY_GUID = 'a4654cd3-5462-4d13-a8d7-0c1fd71733f3'

// Identity must be selected before the single-instance lock. Electron scopes
// the lock to userData, so an installed bundle explicitly launched on the dev
// channel can coexist with the release app and its preferences.
const channel = resolveDesktopChannel(process.env.TOKMON_CHANNEL, app.isPackaged)
process.env.TOKMON_CHANNEL = channel
const identity = desktopIdentity(channel, process.env.TOKMON_DEV_INSTANCE)
app.setName(identity.appName)
if (channel === 'dev') {
  app.setPath('userData', desktopUserDataPath(app.getPath('appData'), identity))
}
const ownsInstanceLock = app.requestSingleInstanceLock()
if (!ownsInstanceLock) app.quit()

// A tray app has no window to re-open: any uncaught defect that takes down the
// main process looks like Tokmon "just shut off". Background refresh and
// updater failures are recoverable — log them, keep the status item alive.
process.on('uncaughtException', error => {
  console.error('[tokmon] uncaught exception in desktop main', error)
})
process.on('unhandledRejection', reason => {
  console.error('[tokmon] unhandled rejection in desktop main', reason)
})

async function bootstrap(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId(
    channel === 'dev' ? 'com.davidilie.tokmon.dev' : 'com.davidilie.tokmon',
  )
  nativeTheme.themeSource = electronThemeSource(DEFAULT_APPEARANCE)
  await app.whenReady()
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')

  const workspaceRoot = path.resolve(runtimeDir, '../../..')
  const webRoot = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(workspaceRoot, 'dist/web')
  const rendererUrl = app.isPackaged
    ? pathToFileURL(path.join(runtimeDir, 'renderer/index.html')).toString()
    : pathToFileURL(path.join(workspaceRoot, 'src/desktop/dist/renderer/index.html')).toString()

  // Establish the native shell before daemon discovery. An incompatible or
  // starting daemon must result in a recoverable tray state, never a vanished app.
  const initialSystemMode = effectiveSystemMode(nativeTheme.shouldUseDarkColors)
  const initialTheme = resolveTheme(DEFAULT_APPEARANCE, initialSystemMode)
  const state = new DesktopStateStore(
    identity.appName,
    app.getVersion(),
    null,
    screen.getPrimaryDisplay().bounds.width,
  )
  state.update({
    systemMode: initialSystemMode,
    loginItem: readDesktopLoginItem(app, process.platform, channel),
  })
  let repaintPresentation = () => {}
  let recoverInstallFailure = () => {}
  let trayUpdateReady = false
  const updater = new DesktopUpdaterController({
    enabled: app.isPackaged && channel === 'release',
    supported: process.platform !== 'linux' || Boolean(process.env.APPIMAGE),
    updater: autoUpdater as DesktopAutoUpdater,
    onState: update => {
      state.updater(update)
      if (update.status === 'error' && closing && nativeUpdateQuitAllowed) {
        queueMicrotask(() => recoverInstallFailure())
      }
      const ready = updateReady(update)
      if (ready !== trayUpdateReady) {
        trayUpdateReady = ready
        repaintPresentation()
      }
    },
    logger: console,
  })
  // A dev shell may run beside the installed release app. Separate status-item
  // identities prevent macOS from assigning both processes the same saved slot.
  const tray = new Tray(createTrayIcon(null, false), channel === 'dev' ? DEV_TRAY_GUID : RELEASE_TRAY_GUID)
  trayRef = tray
  tray.setToolTip(`${identity.appName} — connecting to daemon`)
  if (process.platform === 'darwin') tray.setTitle('')
  const popover = createPopoverWindow(tray, rendererUrl, initialTheme.tokens.chrome)
  state.addTarget(popover.window.webContents)

  const currentDisplayWidth = () => {
    const bounds = tray.getBounds()
    if (bounds.width > 0 && bounds.height > 0) {
      return screen.getDisplayNearestPoint({
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      }).bounds.width
    }
    return screen.getPrimaryDisplay().bounds.width
  }
  const updateDisplayWidth = () => {
    const displayWidthPt = currentDisplayWidth()
    if (state.get().displayWidthPt !== displayWidthPt) {
      state.update({ displayWidthPt })
      repaintPresentation()
    }
  }
  const onDisplayMetricsChanged = () => updateDisplayWidth()
  const onDisplayTopologyChanged = () => updateDisplayWidth()
  screen.on('display-metrics-changed', onDisplayMetricsChanged)
  screen.on('display-added', onDisplayTopologyChanged)
  screen.on('display-removed', onDisplayTopologyChanged)

  const applyAppearance = (appearance = state.get().config?.appearance ?? DEFAULT_APPEARANCE) => {
    const source = electronThemeSource(appearance)
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source
    const systemMode = effectiveSystemMode(nativeTheme.shouldUseDarkColors)
    const resolved = resolveTheme(appearance, systemMode)
    popover.setBackgroundColor(resolved.tokens.chrome)
    if (state.get().systemMode !== systemMode) state.update({ systemMode })
  }
  const onNativeThemeUpdated = () => applyAppearance()
  nativeTheme.on('updated', onNativeThemeUpdated)

  let promotion: PromotionState = { primaryId: null, promotedAt: null }
  let connectAttempt: Promise<void> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectFailures = 0
  let unsubSnapshot: (() => void) | null = null
  let unsubConfig: (() => void) | null = null
  const trayStrip = new TrayStripLifecycle()

  const applyLaunchAtLogin = (enabled: boolean) => {
    state.update({
      loginItem: setDesktopLoginItem(app, process.platform, channel, enabled),
    })
  }

  // Provider-scoped pins (menu-bar order, ≤2), migrated from legacy account pins.
  const validPinnedProviders = (): string[] => {
    const current = state.get()
    if (!current.snapshot || !current.config) return []
    return resolveProviderPins(current.config, current.snapshot)
  }

  const currentPinSignature = () => validPinnedProviders().join(String.fromCharCode(0))

  const clearReconnectTimer = () => {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const showDisconnectedPresentation = (error: unknown = null) => {
    const failed = error !== null
    const ready = updateReady(state.get().update)
    if (!trayStrip.hasComposedImage) tray.setImage(createTrayIcon(null, failed, ready))
    const updateLine = updateTooltipLine(identity.appName, state.get().update)
    const connectionLine = failed
      ? `${identity.appName} — daemon unavailable\n${error instanceof Error ? error.message : String(error)}`
      : `${identity.appName} — connecting to daemon`
    tray.setToolTip(updateLine ? `${updateLine}\n${connectionLine}` : connectionLine)
    if (process.platform === 'darwin') {
      tray.setTitle(trayStrip.hasComposedImage ? '' : disconnectedMenuBarTitle(failed, ready))
    }
  }

  const updatePresentation = () => {
    const current = state.get()
    const snapshot = current.snapshot
    const config = current.config
    if (!snapshot || !config) {
      showDisconnectedPresentation(current.error)
      return
    }
    const now = Date.now()
    const selected = selectPromotedAccounts(promotionAccounts(snapshot), promotion, config.tray, now)
    promotion = selected.state
    // The renderer no longer reorders by activity; it groups by provider in fixed order and
    // shows Active chips from this list. `selected` still feeds the single-icon tray fallback.
    state.update({ activeAccountIds: activeAccountIds(snapshot, config.tray.activeTimeoutMin, now) })
    const account = snapshot.accounts.find(candidate => candidate.id === selected.slots[0]) ?? null
    const fallbackProvider = validPinnedProviders()[0] ?? account?.providerId
    const providerHeadroom = snapshot.providers.find(candidate => candidate.id === fallbackProvider)?.headroom
    const quota = account ? tightestQuota(account) : null
    const remaining = providerHeadroom?.value ?? quota?.remainingPct ?? null
    const usage = usageFromHeadroom(remaining)
    const critical = isCritical(remaining)
    const ready = updateReady(current.update)
    const pinSignature = currentPinSignature()
    trayStrip.observePinSignature(pinSignature)
    if (!trayStrip.hasComposedImage) tray.setImage(createTrayIcon(usage, critical, ready))

    // Tooltip: one honest line per described provider (pinned first, else the promoted
    // providers), each naming its representative account/window/severity/reset in words.
    const pinnedProviders = validPinnedProviders()
    const promotedProviders = [...selected.slots, ...selected.overflow]
      .map(id => snapshot.accounts.find(candidate => candidate.id === id)?.providerId)
      .filter((id): id is NonNullable<typeof id> => id !== undefined)
    const describedProviders = [...pinnedProviders, ...promotedProviders]
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .slice(0, 5)
    const tooltipRows = describedProviders.map(providerId => {
      const accounts = snapshot.accounts.filter(candidate => candidate.providerId === providerId)
      const name = snapshot.providers.find(candidate => candidate.id === providerId)?.name ?? providerId
      const headroom = snapshot.providers.find(candidate => candidate.id === providerId)?.headroom
      return providerTooltipLine(name, accounts, config.privacyMode, snapshot, config.tray.activeTimeoutMin, now, headroom)
    })
    const updateLine = updateTooltipLine(identity.appName, current.update)
    const usageTooltip = tooltipRows.length
      ? `${identity.appName}\n${tooltipRows.join('\n')}`
      : `${identity.appName} is waiting for usage data.`
    tray.setToolTip(updateLine ? `${updateLine}\n${usageTooltip}` : usageTooltip)
    if (process.platform === 'darwin') {
      const fallbackAccounts = fallbackProvider
        ? snapshot.accounts.filter(candidate => candidate.providerId === fallbackProvider)
        : []
      const alternate = config.tray.menuBarValue === 'todayTokens'
        ? formatCompactTokens(providerTodayTokens(fallbackAccounts))
        : undefined
      tray.setTitle(trayStrip.hasComposedImage ? '' : menuBarTitle(config.tray.showMenuBarText, usage, critical, alternate, ready))
    }
  }

  repaintPresentation = () => {
    // Keep the last validated pixels until React supplies the replacement.
    // Main-process signature validation prevents stale pixels being accepted.
    updatePresentation()
  }
  updater.start()

  let installQuitTimer: ReturnType<typeof setTimeout> | null = null
  let installHandoffTimer: ReturnType<typeof setTimeout> | null = null
  const clearInstallTimers = () => {
    if (installQuitTimer) clearTimeout(installQuitTimer)
    if (installHandoffTimer) clearTimeout(installHandoffTimer)
    installQuitTimer = null
    installHandoffTimer = null
  }
  const requestUpdateInstall = async (): Promise<boolean> => {
    if (!await updater.prepareInstall()) return false
    // Give the renderer one calm paint of “Restarting…” before app.quit begins.
    installQuitTimer = setTimeout(() => {
      installQuitTimer = null
      app.quit()
    }, 120)
    installQuitTimer.unref?.()
    return true
  }

  const closeDaemonSession = async () => {
    const activeRpc = rpc
    const activeDaemon = daemon
    rpc = null
    daemon = null
    unsubSnapshot?.()
    unsubConfig?.()
    unsubSnapshot = null
    unsubConfig = null
    state.update({ daemon: null })
    await withTimeout((async () => {
      await activeRpc?.close().catch(() => {})
      await activeDaemon?.stop().catch(() => {})
    })(), 4_000).catch(error => console.warn('[tokmon] background service cleanup timed out', error))
  }

  const scheduleReconnect = (connect: (replace?: boolean) => Promise<void>) => {
    if (closing || reconnectTimer) return
    const delay = Math.min(30_000, 2_000 * 2 ** Math.min(reconnectFailures, 4))
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect(true)
    }, delay)
    reconnectTimer.unref?.()
  }

  const connectDaemon = async (replace = false): Promise<void> => {
    if (closing) return
    if (connectAttempt) return connectAttempt
    if (rpc && !replace) return
    connectAttempt = (async () => {
      clearReconnectTimer()
      if (replace) await closeDaemonSession()
      state.connection(reconnectFailures === 0 ? 'connecting' : 'reconnecting')
      showDisconnectedPresentation()
      try {
        // The web runtime resolves lock isolation from TOKMON_CHANNEL. Packaged
        // dev launches therefore attach to the same dev daemon as pnpm clients.
        process.env.TOKMON_WEB_MODE = 'prod'
        const controller = await acquireOrAttachDaemon({
          ownerKind: 'desktop',
          port: 0,
          webRoot,
          version: app.getVersion(),
        })
        if (closing) {
          await controller.stop().catch(() => {})
          return
        }
        daemon = controller
        state.update({
          daemon: {
            role: controller.role,
            version: controller.lock.version,
            protocolVersion: controller.lock.protocolVersion,
            ownerKind: controller.lock.ownerKind,
            channel: controller.lock.channel,
          },
        })
        const client = createDaemonRpcClient(controller.baseUrl, {
          transport: 'node',
          reconnectAttempts: 8,
          onConn: (connection, error) => {
            if (connection === 'closed' || closing || client !== rpc) return
            state.connection(connection, error)
            if (connection === 'live') {
              reconnectFailures = 0
              clearReconnectTimer()
              updatePresentation()
            } else if (connection === 'error') {
              reconnectFailures += 1
              showDisconnectedPresentation(error)
              scheduleReconnect(connectDaemon)
            }
          },
        })
        rpc = client
        unsubSnapshot = client.subscribeSnapshot(snapshot => {
          state.snapshot(snapshot)
          updatePresentation()
        })
        unsubConfig = client.subscribeConfig(configState => {
          state.config(configState.config, configState.config.revision)
          applyAppearance(configState.config.appearance)
          applyLaunchAtLogin(configState.config.tray.launchAtLogin)
          updatePresentation()
        })
        await client.getConfig()
          .then(value => {
            state.config(value.config, value.config.revision)
            applyAppearance(value.config.appearance)
            applyLaunchAtLogin(value.config.tray.launchAtLogin)
          })
          .catch(error => {
            state.connection('error', error)
            reconnectFailures += 1
            showDisconnectedPresentation(error)
            scheduleReconnect(connectDaemon)
          })
      } catch (error) {
        reconnectFailures += 1
        state.update({ daemon: null })
        state.connection('error', error)
        showDisconnectedPresentation(error)
        scheduleReconnect(connectDaemon)
        // Remain a menu-bar app on startup failures. The error icon, tooltip,
        // and context menu remain available without opening a detached window
        // before macOS has assigned the status item usable bounds.
        console.error('[tokmon] daemon connection failed', error)
      }
    })().finally(() => { connectAttempt = null })
    return connectAttempt
  }

  recoverInstallFailure = () => {
    if (!closing) return
    clearInstallTimers()
    nativeUpdateQuitAllowed = false
    closing = false
    ;(globalThis as { __tokmonQuitting?: boolean }).__tokmonQuitting = false
    void connectDaemon(true)
  }

  const disposeIpc = registerDesktopIpc({
    renderer: popover.window.webContents,
    state,
    getRpc: () => rpc,
    getDashboardUrl: () => daemon?.baseUrl ?? null,
    retryConnection: () => connectDaemon(true),
    checkForUpdates: () => updater.checkForUpdates(),
    installUpdate: requestUpdateInstall,
    setPopoverHeight: height => popover.setHeight(height),
    onConfig: config => {
      applyAppearance(config.appearance)
      applyLaunchAtLogin(config.tray.launchAtLogin)
    },
    onTrayStrip: payload => {
      if (process.platform !== 'darwin') return
      const current = state.get()
      const pinSignature = currentPinSignature()
      if (!trayStripPayloadMatchesState(payload, current, pinSignature)) return
      const decode = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      // Both representations so non-Retina externals get a crisp 1× rather than a downscale.
      const image = nativeImage.createEmpty()
      image.addRepresentation({ scaleFactor: 1, buffer: decode(payload.dataUrl1x) })
      image.addRepresentation({ scaleFactor: 2, buffer: decode(payload.dataUrl2x) })
      if (image.isEmpty()) return
      // Sanity-check the 2× bitmap against the declared logical width; reject a mismatch.
      const size = image.getSize()
      if (size.width === 0 || Math.abs(size.width - payload.logicalWidth) > 2) return
      image.setTemplateImage(true)
      tray.setImage(image)
      tray.setTitle('')
      trayStrip.accept()
    },
  })

  tray.on('click', (_event, bounds) => {
    const requested = state.get().config?.tray.launchAtLogin
    if (requested === undefined) {
      state.update({ loginItem: readDesktopLoginItem(app, process.platform, channel) })
    } else {
      applyLaunchAtLogin(requested)
    }
    popover.toggle(bounds)
  })
  tray.on('right-click', () => {
    const current = state.get()
    const connected = rpc !== null && daemon !== null
    const template: MenuItemConstructorOptions[] = [
      { label: 'Open Tokmon', click: () => popover.show() },
      ...current.error ? [{ label: `Daemon unavailable: ${current.error}`, enabled: false }] : [],
      { label: connected ? 'Reconnect daemon' : 'Retry connection', click: () => void connectDaemon(true) },
      { label: 'Open Dashboard', enabled: connected, click: () => { if (daemon) void shell.openExternal(daemon.baseUrl) } },
      current.update.status === 'downloaded'
        ? {
            label: `Restart to Install ${current.update.availableVersion ?? 'Update'}`,
            click: () => { void requestUpdateInstall() },
          }
        : current.update.status === 'restarting'
          ? { label: 'Restarting to Install…', enabled: false }
        : current.update.status === 'checking'
          ? { label: 'Checking for Updates…', enabled: false }
          : current.update.status === 'available'
            ? { label: `Preparing Update${current.update.availableVersion ? ` ${current.update.availableVersion}` : ''}…`, enabled: false }
          : current.update.status === 'downloading'
            ? {
                label: `Downloading Update${current.update.progressPercent === null ? '…' : ` (${Math.round(current.update.progressPercent)}%)`}`,
                enabled: false,
              }
            : current.update.status === 'disabled'
              ? { label: 'Updates Available in Installed App', enabled: false }
              : current.update.status === 'unsupported'
                ? { label: 'Updates Managed by Package Manager', enabled: false }
                : current.update.status === 'error'
                  ? { label: 'Update Failed — Check Again', click: () => void updater.checkForUpdates() }
                  : { label: 'Check for Updates', click: () => void updater.checkForUpdates() },
      // The stalled-download message tells users to "choose Download Latest";
      // the popover has that button, the tray path must offer it too.
      ...current.update.status === 'error'
        ? [{ label: 'Download Latest…', click: () => { void shell.openExternal(DESKTOP_DOWNLOAD_URL) } }]
        : [],
      { type: 'separator' },
      { label: 'Quit Tokmon', click: () => app.quit() },
    ]
    tray.popUpContextMenu(Menu.buildFromTemplate(template))
  })

  // Wake-from-sleep leaves the RPC socket half-open: the daemon may also have
  // been retired/updated while suspended. Redial immediately instead of waiting
  // for the 90s stale-snapshot watchdog to notice.
  const onResume = () => {
    if (closing) return
    if (rpc) rpc.reconnectNow()
    else void connectDaemon(true)
  }
  powerMonitor.on('resume', onResume)
  if (process.platform === 'darwin') powerMonitor.on('unlock-screen', onResume)

  // A crashed/killed renderer leaves an empty popover and a stale tray strip
  // with no path back. Reload once per crash; repeated crashes surface in logs.
  popover.window.webContents.on('render-process-gone', (_event, details) => {
    if (closing || details.reason === 'clean-exit') return
    console.error('[tokmon] renderer process gone', details.reason)
    trayStrip.reset()
    popover.window.webContents.reload()
  })

  if (process.env.TOKMON_DESKTOP_SHOW_ON_START === '1') popover.show()
  void connectDaemon()

  const screenshotPath = process.env.TOKMON_DESKTOP_SCREENSHOT_PATH
  if (screenshotPath) {
    const capture = () => {
      setTimeout(() => {
        void popover.window.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(requestAnimationFrame))')
          .then(() => popover.window.capturePage())
          .then(image => writeFile(screenshotPath, image.toPNG()))
          .catch(error => console.error('[tokmon] screenshot capture failed', error))
      }, 5_000)
    }
    if (popover.window.webContents.isLoading()) popover.window.webContents.once('did-finish-load', capture)
    else capture()
  }

  // Electron's default window-all-closed behavior quits the app on
  // Windows/Linux. The popover normally hides instead of closing, but a
  // destroyed window (crash, display teardown) must not take the tray with it.
  app.on('window-all-closed', () => {})

  app.on('second-instance', () => popover.show())
  app.on('before-quit', event => {
    if (nativeUpdateQuitAllowed) return
    event.preventDefault()
    if (closing) return
    closing = true
    ;(globalThis as { __tokmonQuitting?: boolean }).__tokmonQuitting = true
    clearReconnectTimer()
    if (installQuitTimer) {
      clearTimeout(installQuitTimer)
      installQuitTimer = null
    }
    void closeDaemonSession().finally(() => {
      if (updater.state.status === 'restarting') nativeUpdateQuitAllowed = true
      const outcome = updater.completeQuit(() => app.exit(0))
      if (outcome === 'install') {
        installHandoffTimer = setTimeout(() => {
          installHandoffTimer = null
          updater.failInstallHandoff('Tokmon could not hand off to the installer within 2 minutes. Choose Check for Updates to retry.')
        }, UPDATE_INSTALL_HANDOFF_TIMEOUT_MS)
        installHandoffTimer.unref?.()
        return
      }
      nativeUpdateQuitAllowed = false
      if (outcome === 'error') recoverInstallFailure()
    })
  })
  app.on('will-quit', () => {
    trayRef = null
    clearInstallTimers()
    nativeTheme.removeListener('updated', onNativeThemeUpdated)
    screen.removeListener('display-metrics-changed', onDisplayMetricsChanged)
    screen.removeListener('display-added', onDisplayTopologyChanged)
    screen.removeListener('display-removed', onDisplayTopologyChanged)
    disposeIpc()
    updater.stop()
  })
}

if (ownsInstanceLock) {
  void bootstrap().catch(error => {
    // Native-shell failures are exceptional; daemon acquisition is handled
    // inside bootstrap and never reaches this path.
    console.error('[tokmon] desktop shell startup failed', error)
  })
}
