import type { DesktopApi } from '../shared/desktop-contract'

declare global {
  interface Window {
    tokmon: DesktopApi
  }
}

export {}
