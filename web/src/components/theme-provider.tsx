import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_APPEARANCE,
  type AppearanceConfig,
  type ConfigState,
} from '@shared'
import { getConfig, setAppearanceMode, subscribeConfig } from '../lib/config-client'
import {
  applyThemeToRoot,
  cacheResolvedTheme,
  cycleThemeMode,
  resolveWebTheme,
  setThemeMetadata,
  type ResolvedWebTheme,
} from '../lib/theme-runtime'

interface ThemeContextValue {
  appearance: AppearanceConfig
  resolved: ResolvedWebTheme
  ready: boolean
  setPreview(appearance: AppearanceConfig | null): void
  commit(state: ConfigState): void
  toggleMode(): Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function subscribeSystemTheme(listener: (dark: boolean) => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (event: MediaQueryListEvent) => listener(event.matches)
  media.addEventListener('change', onChange)
  listener(media.matches)
  return () => media.removeEventListener('change', onChange)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfigState | null>(null)
  const [preview, setPreview] = useState<AppearanceConfig | null>(null)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const stateRef = useRef<ConfigState | null>(null)

  const accept = useCallback((next: ConfigState) => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => subscribeSystemTheme(setSystemDark), [])

  useEffect(() => {
    let alive = true
    void getConfig().then(next => { if (alive) accept(next) }).catch(() => {})
    const unsubscribe = subscribeConfig(next => { if (alive) accept(next) })
    return () => { alive = false; unsubscribe() }
  }, [accept])

  const appearance = preview ?? state?.config.appearance ?? DEFAULT_APPEARANCE
  const resolved = useMemo(() => resolveWebTheme(appearance, systemDark), [appearance, systemDark])

  useEffect(() => {
    // Leave the validated first-paint cache in control until the daemon answers.
    if (!state && !preview) return
    applyThemeToRoot(document.documentElement, resolved)
    setThemeMetadata(resolved.mode, resolved.tokens.canvas)
    if (!preview) cacheResolvedTheme(resolved)
  }, [preview, resolved, state])

  const toggleMode = useCallback(async () => {
    const current = stateRef.current
    if (!current) return
    const desired = cycleThemeMode(current.config.appearance.mode)
    try {
      accept(await setAppearanceMode(current, desired))
    } catch { }
  }, [accept])

  const value = useMemo<ThemeContextValue>(() => ({
    appearance,
    resolved,
    ready: state !== null,
    setPreview,
    commit: next => { setPreview(null); accept(next) },
    toggleMode,
  }), [accept, appearance, resolved, state, toggleMode])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
