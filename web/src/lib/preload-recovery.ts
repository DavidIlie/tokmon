const PRELOAD_RELOAD_KEY = 'tokmon.preloadReloadAt'
export const PRELOAD_RELOAD_COOLDOWN_MS = 30_000

export function shouldReloadForPreloadFailure(lastReloadAt: number, now: number): boolean {
  return !Number.isFinite(lastReloadAt) || now - lastReloadAt >= PRELOAD_RELOAD_COOLDOWN_MS
}

/** Recover once when an upgrade removes a lazy chunk loaded by an older tab. */
export function installPreloadRecovery(): () => void {
  const onPreloadError = (event: Event) => {
    event.preventDefault()
    let lastReloadAt = Number.NaN
    try { lastReloadAt = Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY)) } catch {}
    const now = Date.now()
    if (!shouldReloadForPreloadFailure(lastReloadAt, now)) return
    try { window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(now)) } catch {}
    window.location.reload()
  }
  window.addEventListener('vite:preloadError', onPreloadError)
  return () => window.removeEventListener('vite:preloadError', onPreloadError)
}
