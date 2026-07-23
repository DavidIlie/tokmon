import type { App } from 'electron'
import type {
  DesktopLoginItemState,
  DesktopLoginItemStatus,
} from '../shared/desktop-contract'
import type { DesktopChannel } from './desktop-runtime'

type LoginItemApp = Pick<App, 'getLoginItemSettings' | 'setLoginItemSettings'> & {
  isPackaged: boolean
}

function unavailableStatus(
  app: LoginItemApp,
  platform: NodeJS.Platform,
  channel: DesktopChannel,
): DesktopLoginItemStatus | null {
  if (!app.isPackaged || channel !== 'release') return 'development'
  if (platform !== 'darwin' && platform !== 'win32') return 'unsupported'
  return null
}

function loginItemState(
  status: DesktopLoginItemStatus,
  enabled = status === 'enabled',
): DesktopLoginItemState {
  return { status, enabled, error: null }
}

function readNativeState(
  app: LoginItemApp,
  platform: NodeJS.Platform,
): DesktopLoginItemState {
  const settings = app.getLoginItemSettings(
    platform === 'darwin' ? { type: 'mainAppService' } : undefined,
  )
  if (platform === 'darwin') {
    if (settings.status === 'requires-approval') {
      return loginItemState('requires-approval')
    }
    if (settings.status === 'not-found') return loginItemState('not-found')
    return loginItemState(settings.openAtLogin && settings.status === 'enabled' ? 'enabled' : 'disabled')
  }
  const enabled = settings.openAtLogin && settings.executableWillLaunchAtLogin !== false
  return loginItemState(enabled ? 'enabled' : 'disabled')
}

export function readDesktopLoginItem(
  app: LoginItemApp,
  platform: NodeJS.Platform,
  channel: DesktopChannel,
): DesktopLoginItemState {
  const unavailable = unavailableStatus(app, platform, channel)
  if (unavailable) return loginItemState(unavailable)
  try {
    return readNativeState(app, platform)
  } catch (error) {
    return {
      status: 'error',
      enabled: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function setDesktopLoginItem(
  app: LoginItemApp,
  platform: NodeJS.Platform,
  channel: DesktopChannel,
  enabled: boolean,
): DesktopLoginItemState {
  const unavailable = unavailableStatus(app, platform, channel)
  if (unavailable) return loginItemState(unavailable)
  try {
    const current = readNativeState(app, platform)
    if (enabled && (current.status === 'enabled' || current.status === 'requires-approval')) return current
    if (!enabled && (current.status === 'disabled' || current.status === 'not-found')) return current
    app.setLoginItemSettings(platform === 'darwin'
      ? { openAtLogin: enabled, type: 'mainAppService' }
      : { openAtLogin: enabled, ...(enabled ? { enabled: true } : {}) })
    return readNativeState(app, platform)
  } catch (error) {
    return {
      status: 'error',
      enabled: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
