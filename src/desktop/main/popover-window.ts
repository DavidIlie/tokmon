import { BrowserWindow, screen, type Tray } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { availableCenteredHeight, availablePopoverHeight, centeredPopover, popoverPlacement, positionPopover, usableTrayBounds, type Rect } from './popover-position'
import { popoverPlatformBehavior } from './popover-behavior'
import { DESKTOP_CHANNELS } from '../shared/desktop-contract'

const WIDTH = 360
const MIN_HEIGHT = 220
const MAX_HEIGHT = 640
const runtimeDir = path.dirname(fileURLToPath(import.meta.url))

export interface PopoverWindowController {
  window: BrowserWindow
  toggle(anchorBounds?: Rect): void
  show(anchorBounds?: Rect): void
  hide(): void
  setHeight(height: number): void
  setBackgroundColor(color: string): void
}

export function createPopoverWindow(tray: Tray, rendererUrl: string, initialBackground = '#1e1f22'): PopoverWindowController {
  const linux = process.platform === 'linux'
  const mac = process.platform === 'darwin'
  const wayland = linux && process.env.XDG_SESSION_TYPE === 'wayland'
  const behavior = popoverPlatformBehavior(process.platform)
  const window = new BrowserWindow({
    width: WIDTH,
    height: 300,
    minWidth: WIDTH,
    maxWidth: WIDTH,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
    show: false,
    frame: false,
    transparent: mac,
    backgroundColor: mac ? '#00000000' : initialBackground,
    roundedCorners: mac,
    hasShadow: true,
    resizable: wayland,
    movable: wayland,
    skipTaskbar: true,
    alwaysOnTop: true,
    ...(behavior.type ? { type: behavior.type } : {}),
    acceptFirstMouse: behavior.acceptFirstMouse,
    hiddenInMissionControl: behavior.hiddenInMissionControl,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(runtimeDir, 'preload.cjs'),
      // The hidden renderer paints the composed two-provider macOS status item.
      // Throttling it while the popover is closed would leave the tray stale.
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  window.setVisibleOnAllWorkspaces(true, behavior.visibleOnAllWorkspaces)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) event.preventDefault()
  })
  window.loadURL(rendererUrl).catch(error => console.error('[tokmon] renderer failed to load', error))
  window.on('hide', () => {
    if (!window.webContents.isDestroyed()) window.webContents.send(DESKTOP_CHANNELS.popoverHidden)
  })
  window.on('blur', () => { if (!wayland) window.hide() })
  window.on('close', event => {
    if (!(globalThis as { __tokmonQuitting?: boolean }).__tokmonQuitting) {
      event.preventDefault()
      window.hide()
    }
  })

  let pendingShow: ReturnType<typeof setTimeout> | null = null
  let activeAnchor: Rect | null = null
  const clearPendingShow = () => {
    if (pendingShow) clearTimeout(pendingShow)
    pendingShow = null
  }
  const place = (): boolean => {
    const trayBounds = activeAnchor ?? tray.getBounds()
    if (!usableTrayBounds(trayBounds, mac)) return false
    const display = screen.getDisplayNearestPoint({
      x: Math.round(trayBounds.x + trayBounds.width / 2),
      y: Math.round(trayBounds.y + trayBounds.height / 2),
    })
    const size = window.getBounds()
    const position = linux
      ? centeredPopover(display.workArea, size)
      : positionPopover(trayBounds, display.workArea, size)
    window.setPosition(position.x, position.y, false)
    return true
  }
  const reveal = () => {
    if (window.isDestroyed()) return
    window.show()
    if (behavior.focusAfterShow) window.focus()
  }
  const show = (anchorBounds?: Rect) => {
    clearPendingShow()
    activeAnchor = anchorBounds ?? null
    let attempts = 0
    const placeAndReveal = () => {
      if (window.isDestroyed()) return
      if (place()) {
        pendingShow = null
        reveal()
        return
      }
      attempts += 1
      if (attempts < 20) {
        pendingShow = setTimeout(placeAndReveal, 50)
        return
      }
      // A deliberately hidden/unsupported tray should not make an explicit
      // "Open Tokmon" action disappear. Centering is an honest fallback;
      // anchoring empty bounds to (0, 0) looked like a broken corner window.
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const position = centeredPopover(display.workArea, window.getBounds())
      window.setPosition(position.x, position.y, false)
      pendingShow = null
      reveal()
    }
    placeAndReveal()
  }
  return {
    window,
    show,
    hide: () => { clearPendingShow(); activeAnchor = null; window.hide() },
    toggle: anchorBounds => window.isVisible() ? window.hide() : show(anchorBounds),
    setBackgroundColor(color) {
      // Transparent macOS windows get their rounded surface from the renderer.
      // Opaque Windows/Linux shells use the same resolved token natively so
      // resize and navigation frames never flash a hard-coded dark color.
      if (!mac) window.setBackgroundColor(color)
    },
    setHeight(height) {
      const trayBounds = activeAnchor ?? tray.getBounds()
      const display = screen.getDisplayNearestPoint({
        x: Math.round(trayBounds.x + trayBounds.width / 2),
        y: Math.round(trayBounds.y + trayBounds.height / 2),
      })
      // Size in whatever direction the popover actually opens. Linux centers the
      // window (see place()), so it may use the full work-area height; every
      // other platform sizes against the room available on the placement side —
      // never assuming "below the tray", which truncated bottom/side taskbars.
      const available = linux
        ? availableCenteredHeight(display.workArea)
        : availablePopoverHeight(trayBounds, display.workArea, popoverPlacement(trayBounds, display.workArea))
      const ceiling = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, available))
      const next = Math.round(Math.max(MIN_HEIGHT, Math.min(ceiling, height)))
      if (window.getBounds().height === next) return
      window.setSize(WIDTH, next, false)
      if (window.isVisible()) place()
    },
  }
}
