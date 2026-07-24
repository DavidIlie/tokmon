import { app, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { DaemonRpcClient } from '../../client/daemon-rpc-client'
import type { Config } from '../../config-schema'
import {
  DASHBOARD_PATHS,
  DESKTOP_CHANNELS,
  isTrayStripPayload,
  type DashboardPath,
  type DesktopRefreshScope,
  type TrayStripPayload,
} from '../shared/desktop-contract'
import { dashboardDeepLink } from './dashboard-deep-link'
import type { DesktopStateStore } from './desktop-state'

const REFRESH_SCOPES = new Set<DesktopRefreshScope>(['all', 'summary', 'table', 'billing', 'peak'])
const ALLOWED_PATHS = new Set<string>(DASHBOARD_PATHS)

export interface DesktopIpcOptions {
  renderer: WebContents
  state: DesktopStateStore
  getRpc(): DaemonRpcClient | null
  getDashboardUrl(): string | null
  retryConnection(): Promise<void>
  checkForUpdates(): Promise<void>
  installUpdate(): boolean
  setPopoverHeight(height: number): void
  onConfig?(config: Config): void
  /** Consume the renderer-painted menu-bar strip (macOS). Absent → strip is ignored. */
  onTrayStrip?(payload: TrayStripPayload): void
}

export function registerDesktopIpc(opts: DesktopIpcOptions): () => void {
  const channels = Object.values(DESKTOP_CHANNELS)
  const assertSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== opts.renderer || event.senderFrame !== opts.renderer.mainFrame) {
      throw new Error('untrusted desktop IPC sender')
    }
  }
  const requireRpc = () => {
    const rpc = opts.getRpc()
    if (!rpc) throw new Error('Tokmon daemon is not connected')
    return rpc
  }

  ipcMain.handle(DESKTOP_CHANNELS.getState, event => {
    assertSender(event)
    return opts.state.get()
  })
  ipcMain.handle(DESKTOP_CHANNELS.refresh, async (event, scope: unknown) => {
    assertSender(event)
    if (typeof scope !== 'string' || !REFRESH_SCOPES.has(scope as DesktopRefreshScope)) {
      throw new Error('invalid refresh scope')
    }
    await requireRpc().refresh(scope as DesktopRefreshScope)
  })
  ipcMain.handle(DESKTOP_CHANNELS.setConfig, async (event, config: unknown, expectedRevision: unknown) => {
    assertSender(event)
    if (!config || typeof config !== 'object' || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
      throw new Error('invalid config update')
    }
    const next = await requireRpc().setConfig({ config: config as Config, expectedRevision: expectedRevision as number })
    opts.state.config(next.config, next.config.revision)
    opts.onConfig?.(next.config)
    return opts.state.get()
  })
  ipcMain.handle(DESKTOP_CHANNELS.retryConnection, async event => {
    assertSender(event)
    await opts.retryConnection()
  })
  ipcMain.handle(DESKTOP_CHANNELS.openDashboard, async (event, path: unknown) => {
    assertSender(event)
    if (path !== undefined && (typeof path !== 'string' || !ALLOWED_PATHS.has(path))) {
      throw new Error('refusing to open a non-allowlisted dashboard path')
    }
    const dashboardUrl = opts.getDashboardUrl()
    if (!dashboardUrl) throw new Error('Tokmon daemon is not connected')
    const url = new URL(dashboardUrl)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new Error('refusing to open a non-loopback dashboard URL')
    }
    const dashboardPath = (path as DashboardPath | undefined) ?? '/'
    // The dashboard uses hash history; the HTTP pathname must keep serving the SPA root.
    await shell.openExternal(dashboardDeepLink(url.toString(), dashboardPath))
  })
  ipcMain.handle(DESKTOP_CHANNELS.checkForUpdates, async event => {
    assertSender(event)
    await opts.checkForUpdates()
  })
  ipcMain.handle(DESKTOP_CHANNELS.installUpdate, event => {
    assertSender(event)
    return opts.installUpdate()
  })
  ipcMain.handle(DESKTOP_CHANNELS.trayStrip, (event, payload: unknown) => {
    assertSender(event)
    if (!isTrayStripPayload(payload)) {
      throw new Error('invalid tray strip payload')
    }
    opts.onTrayStrip?.(payload)
  })
  ipcMain.handle(DESKTOP_CHANNELS.setPopoverHeight, (event, height: unknown) => {
    assertSender(event)
    if (typeof height !== 'number' || !Number.isFinite(height)) throw new Error('invalid popover height')
    opts.setPopoverHeight(height)
  })
  ipcMain.handle(DESKTOP_CHANNELS.quit, event => {
    assertSender(event)
    setImmediate(() => app.quit())
  })

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
