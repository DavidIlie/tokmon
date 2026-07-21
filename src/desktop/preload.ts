import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_CHANNELS,
  type DashboardPath,
  type DesktopApi,
  type DesktopRefreshScope,
  type DesktopState,
  type TrayStripPayload,
} from './shared/desktop-contract'
import type { Config } from '../web/contract'

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getState) as Promise<DesktopState>,
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState) => listener(state)
    ipcRenderer.on(DESKTOP_CHANNELS.state, handler)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.state, handler)
  },
  subscribePopoverHidden(listener) {
    const handler = () => listener()
    ipcRenderer.on(DESKTOP_CHANNELS.popoverHidden, handler)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.popoverHidden, handler)
  },
  refresh: (scope: DesktopRefreshScope = 'all') => ipcRenderer.invoke(DESKTOP_CHANNELS.refresh, scope) as Promise<void>,
  setConfig: (config: Config, expectedRevision: number) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setConfig, config, expectedRevision) as Promise<DesktopState>,
  retryConnection: () => ipcRenderer.invoke(DESKTOP_CHANNELS.retryConnection) as Promise<void>,
  openDashboard: (path?: DashboardPath) => ipcRenderer.invoke(DESKTOP_CHANNELS.openDashboard, path) as Promise<void>,
  checkForUpdates: () => ipcRenderer.invoke(DESKTOP_CHANNELS.checkForUpdates) as Promise<void>,
  installUpdate: () => ipcRenderer.invoke(DESKTOP_CHANNELS.installUpdate) as Promise<boolean>,
  setPopoverHeight: (height: number) => ipcRenderer.invoke(DESKTOP_CHANNELS.setPopoverHeight, height) as Promise<void>,
  sendTrayStrip: (payload: TrayStripPayload) => ipcRenderer.invoke(DESKTOP_CHANNELS.trayStrip, payload) as Promise<void>,
  quit: () => ipcRenderer.invoke(DESKTOP_CHANNELS.quit) as Promise<void>,
}

contextBridge.exposeInMainWorld('tokmon', api)
