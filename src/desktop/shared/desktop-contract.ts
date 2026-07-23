import type { Config, WebSnapshot } from '../../web/contract'

export const DESKTOP_CHANNELS = {
  getState: 'tokmon:desktop:get-state',
  state: 'tokmon:desktop:state',
  popoverHidden: 'tokmon:desktop:popover-hidden',
  refresh: 'tokmon:desktop:refresh',
  setConfig: 'tokmon:desktop:set-config',
  retryConnection: 'tokmon:desktop:retry-connection',
  openDashboard: 'tokmon:desktop:open-dashboard',
  checkForUpdates: 'tokmon:desktop:check-for-updates',
  installUpdate: 'tokmon:desktop:install-update',
  setPopoverHeight: 'tokmon:desktop:set-popover-height',
  trayStrip: 'tokmon:desktop:tray-strip',
  quit: 'tokmon:desktop:quit',
} as const

export type DesktopConnectionState = 'connecting' | 'live' | 'reconnecting' | 'error'
export type DesktopRefreshScope = 'all' | 'summary' | 'table' | 'billing' | 'peak'
export type DesktopUpdateStatus = 'disabled' | 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'
export type DesktopLoginItemStatus = 'unsupported' | 'development' | 'disabled' | 'enabled' | 'requires-approval' | 'not-found' | 'error'

export interface DesktopLoginItemState {
  status: DesktopLoginItemStatus
  /** Native OS state, which can differ from the requested config after OS-level denial. */
  enabled: boolean
  error: string | null
}

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  availableVersion: string | null
  progressPercent: number | null
  error: string | null
}

/** Dashboard subpaths the popover is allowed to open (loopback-guarded in main). */
export const DASHBOARD_PATHS = ['/', '/settings'] as const
export type DashboardPath = typeof DASHBOARD_PATHS[number]

/** Renderer → main composed menu-bar strip (a template image the renderer paints on canvas). */
export interface TrayStripPayload {
  /** PNG data URL of the 1× monochrome strip (non-Retina displays), black-on-transparent. */
  dataUrl1x: string
  /** PNG data URL of the 2× monochrome strip (Retina), black-on-transparent. */
  dataUrl2x: string
  /** Logical (1×) width in points; main sanity-checks it against the 2× bitmap. */
  logicalWidth: number
  /** Lets main reject a stale renderer image after updater state changes. */
  updateReady: boolean
  /** CAS revision whose presentation settings produced these pixels. */
  configRevision: number
  /** Snapshot generation whose provider values/activity produced these pixels. */
  snapshotGeneratedAt: number
  /** NUL-delimited ordered provider pins; main compares without parsing image data. */
  pinSignature: string
  /** Display width used by the adaptive plan, in device-independent points. */
  displayWidthPt: number
  /** Stable signature over every render-affecting leaf. */
  renderSignature: string
}

export function isTrayStripPayload(payload: unknown): payload is TrayStripPayload {
  const strip = payload as TrayStripPayload
  const validPng = (value: unknown): value is string =>
    typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length <= 256_000
  return Boolean(
    payload && typeof payload === 'object'
    && validPng(strip.dataUrl1x)
    && validPng(strip.dataUrl2x)
    && typeof strip.logicalWidth === 'number'
    && Number.isFinite(strip.logicalWidth)
    && strip.logicalWidth >= 12
    && strip.logicalWidth <= 224
    && typeof strip.updateReady === 'boolean'
    && Number.isSafeInteger(strip.configRevision)
    && strip.configRevision >= 0
    && Number.isSafeInteger(strip.snapshotGeneratedAt)
    && strip.snapshotGeneratedAt >= 0
    && typeof strip.pinSignature === 'string'
    && strip.pinSignature.length <= 256
    && typeof strip.displayWidthPt === 'number'
    && Number.isFinite(strip.displayWidthPt)
    && strip.displayWidthPt >= 320
    && strip.displayWidthPt <= 16_384
    && typeof strip.renderSignature === 'string'
    && strip.renderSignature.length >= 2
    && strip.renderSignature.length <= 8_192,
  )
}

export interface DesktopDaemonState {
  version: string
  protocolVersion: number
  ownerKind: 'cli' | 'desktop'
  role: 'owner' | 'attached'
  channel: 'release' | 'dev'
}

export interface DesktopState {
  /** Electron bundle identity. Never substitute the attached daemon version. */
  appName: string
  appVersion: string
  update: DesktopUpdateState
  loginItem: DesktopLoginItemState
  snapshot: WebSnapshot | null
  config: Config | null
  configRevision: number | null
  connection: DesktopConnectionState
  /** Whitelisted lock identity only; never includes URLs, paths, tokens, PIDs, or owner proofs. */
  daemon: DesktopDaemonState | null
  platform: NodeJS.Platform
  /** Display width nearest the status item, in device-independent points. */
  displayWidthPt: number
  /** Effective OS appearance forwarded by Electron; auto themes resolve from this live value. */
  systemMode: 'light' | 'dark'
  /** Accounts with activity inside `tray.activeTimeoutMin` — emphasis only, never reorders. */
  activeAccountIds: string[]
  error: string | null
}

export interface DesktopApi {
  getState(): Promise<DesktopState>
  subscribe(listener: (state: DesktopState) => void): () => void
  /** Fired after every native popover hide so renderer navigation resets. */
  subscribePopoverHidden(listener: () => void): () => void
  refresh(scope?: DesktopRefreshScope): Promise<void>
  setConfig(config: Config, expectedRevision: number): Promise<DesktopState>
  retryConnection(): Promise<void>
  openDashboard(path?: DashboardPath): Promise<void>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<boolean>
  setPopoverHeight(height: number): Promise<void>
  /** Push the composed menu-bar strip (macOS). No-op on platforms without `setTitle`. */
  sendTrayStrip(payload: TrayStripPayload): Promise<void>
  quit(): Promise<void>
}
