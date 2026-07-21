import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Config } from '../../web/contract'
import type { DashboardPath, DesktopState } from '../shared/desktop-contract'
import { matchesPrivacyShortcut } from './privacy'
import { readExpandedProviders, writeExpandedProviders } from './disclosure-state'
import {
  groupByProvider,
  MAX_PINS,
  resolveProviderPins,
  togglePin,
} from './presentation'
import { ProviderCard } from './provider-card'
import { ColdState, DesktopSettings, DetectionSettings, EmptyState, Footer, SettingsHub, ThemeSettings, UpdateReady } from './desktop-chrome'
import { TrayStripPainter } from './tray-strip-painter'
import { OptimisticConfigUpdates } from './config-updates'
import { applyDesktopTheme } from './theme'

function Toast({ message }: { message: string }) {
  return <div className="toast" role="status">{message}</div>
}

// ── App ──────────────────────────────────────────────────────────────────────
export function App() {
  const [state, setState] = useState<DesktopState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [toast, setToast] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [surface, setSurface] = useState<'usage' | 'settings' | 'theme' | 'desktop' | 'detection'>('usage')
  const [denyProvider, setDenyProvider] = useState<string | null>(null)
  const [scrollEdges, setScrollEdges] = useState({ up: false, down: false })
  const frame = useRef<HTMLDivElement>(null)
  const sections = useRef<HTMLDivElement>(null)
  const scrollAnchor = useRef<{ providerId: string; top: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const denyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastPopoverHeight = useRef<number | null>(null)
  const seeded = useRef(false)
  const configQueue = useRef<Promise<void>>(Promise.resolve())
  const configUpdates = useRef(new OptimisticConfigUpdates())

  useEffect(() => {
    const accept = (next: DesktopState) => setState(configUpdates.current.accept(next))
    void window.tokmon.getState().then(accept)
    return window.tokmon.subscribe(accept)
  }, [])

  useEffect(() => window.tokmon.subscribePopoverHidden(() => {
    setSurface('usage')
    setScrollEdges({ up: false, down: false })
  }), [])

  useEffect(() => {
    const root = frame.current
    if (!root) return
    let animationFrame = 0
    const measure = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        const content = root.querySelector<HTMLElement>('.sections, .cold')
        const footer = root.querySelector<HTMLElement>('.footer')
        const contentHeight = content?.scrollHeight ?? root.scrollHeight
        const footerHeight = footer?.offsetHeight ?? 0
        const height = Math.ceil(contentHeight + footerHeight)
        if (height === lastPopoverHeight.current) return
        lastPopoverHeight.current = height
        void window.tokmon.setPopoverHeight(height)
      })
    }
    const resizeObserver = new ResizeObserver(measure)
    const mutationObserver = new MutationObserver(measure)
    resizeObserver.observe(root)
    mutationObserver.observe(root, { childList: true, characterData: true, subtree: true, attributes: true })
    measure()
    return () => {
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [])

  // Coarse clock: reset/updated copy stays calm and reduced-motion friendly.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(interval)
  }, [])

  const snapshot = state?.snapshot ?? null
  const config = state?.config ?? null

  // Apply the shared palette before layout effects measure the popover. Theme
  // changes are an immediate root-level token swap, not a subtree observation
  // or animated repaint, so Auto follows the OS without disclosure lag.
  useLayoutEffect(() => {
    if (!config) return
    applyDesktopTheme(document.documentElement, config.appearance, state?.systemMode ?? 'dark')
  }, [config?.appearance, state?.systemMode])

  const groups = useMemo(() => (snapshot ? groupByProvider(snapshot) : []), [snapshot])
  const pins = useMemo(() => (config && snapshot ? resolveProviderPins(config, snapshot) : []), [config, snapshot])

  const flashToast = useCallback((message: string) => {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }, [])

  const updateConfig = useCallback((mutate: (config: Config) => Config) => {
    const enqueued = configUpdates.current.enqueue(mutate)
    if (enqueued.state) setState(enqueued.state)
    const operation = configQueue.current.then(async () => {
      let latest = await window.tokmon.getState()
      let attempt = () => {
        const next = configUpdates.current.begin(enqueued.id, latest)
        setState(next.state)
        return window.tokmon.setConfig(next.config, latest.configRevision!)
      }
      let confirmed: DesktopState
      try { confirmed = await attempt() }
      catch {
        latest = await window.tokmon.getState()
        attempt = () => {
          const next = configUpdates.current.begin(enqueued.id, latest)
          setState(next.state)
          return window.tokmon.setConfig(next.config, latest.configRevision!)
        }
        confirmed = await attempt()
      }
      setState(configUpdates.current.complete(enqueued.id, confirmed))
    }).catch(async () => {
      // Roll back an optimistic paint to the last daemon-confirmed state.
      const latest = await window.tokmon.getState().catch(() => null)
      const reconciled = latest
        ? configUpdates.current.fail(enqueued.id, latest)
        : configUpdates.current.cancel(enqueued.id)
      if (reconciled) setState(reconciled)
      flashToast('Couldn’t save desktop settings. Try again.')
    })
    configQueue.current = operation
    return enqueued.state?.config ?? null
  }, [flashToast])

  // The daemon is authoritative. localStorage is only a one-time upgrade fallback
  // and a fast paint cache while an older daemon is attached.
  useEffect(() => {
    if (seeded.current || !config || !snapshot || groups.length === 0) return
    seeded.current = true
    const providerIds = new Set(groups.map(group => group.providerId))
    const local = readExpandedProviders(
      window.localStorage,
      providerIds,
      config.desktop?.expandedProviders ?? [],
    )
    const daemonExpanded = (config.desktop?.expandedProviders ?? []).filter(id => providerIds.has(id))
    const initial = groups.length === 1 ? [groups[0]!.providerId] : daemonExpanded.length > 0 ? daemonExpanded : local
    setExpanded(new Set(initial))
    try { writeExpandedProviders(window.localStorage, initial, providerIds) } catch {}
    if (daemonExpanded.length === 0 && initial.length > 0) {
      void updateConfig(next => ({ ...next, desktop: { ...next.desktop, expandedProviders: initial } }))
    }
  }, [config, snapshot, groups, updateConfig])

  const persistExpansion = useCallback((next: Set<string>) => {
    clearTimeout(persistTimer.current)
    const known = new Set(groups.map(group => group.providerId))
    const ids = [...next].filter(id => known.has(id))
    persistTimer.current = setTimeout(() => {
      try { writeExpandedProviders(window.localStorage, ids, known) } catch {}
      void updateConfig(next => ({ ...next, desktop: { ...next.desktop, expandedProviders: ids } }))
    }, 100)
  }, [groups, updateConfig])

  useEffect(() => () => {
    clearTimeout(persistTimer.current)
    clearTimeout(toastTimer.current)
    clearTimeout(denyTimer.current)
  }, [])

  const onToggleProvider = useCallback((providerId: string) => {
    const header = document.getElementById(`provider-header-${providerId}`)
    if (header) scrollAnchor.current = { providerId, top: header.getBoundingClientRect().top }
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      persistExpansion(next)
      return next
    })
  }, [persistExpansion])

  const updateScrollEdges = useCallback((element = sections.current) => {
    if (!element) return
    const next = {
      up: element.scrollTop > 1,
      down: element.scrollTop + element.clientHeight < element.scrollHeight - 1,
    }
    setScrollEdges(current => current.up === next.up && current.down === next.down ? current : next)
  }, [])

  useLayoutEffect(() => {
    const anchor = scrollAnchor.current
    const element = sections.current
    if (anchor && element) {
      const header = document.getElementById(`provider-header-${anchor.providerId}`)
      if (header) element.scrollTop += header.getBoundingClientRect().top - anchor.top
    }
    scrollAnchor.current = null
    updateScrollEdges(element)
  }, [expanded, updateScrollEdges])

  useEffect(() => {
    const element = sections.current
    if (!element) {
      setScrollEdges(current => current.up || current.down ? { up: false, down: false } : current)
      return
    }
    const update = () => updateScrollEdges(element)
    const resize = new ResizeObserver(update)
    const mutation = new MutationObserver(update)
    resize.observe(element)
    mutation.observe(element, { childList: true, characterData: true, subtree: true })
    update()
    return () => { resize.disconnect(); mutation.disconnect() }
  }, [state?.connection, groups.length, updateScrollEdges])

  const onPinProvider = useCallback((providerId: string) => {
    const result = togglePin(pins, providerId)
    if (result.rejected) {
      flashToast(`Up to ${MAX_PINS} providers in the menu bar.`)
      setDenyProvider(providerId)
      clearTimeout(denyTimer.current)
      denyTimer.current = setTimeout(() => setDenyProvider(null), 360)
      return
    }
    void updateConfig(next => ({
      ...next,
      tray: { ...next.tray, pinnedProviders: result.pins, pins: [], pinnedAccount: null },
    }))
  }, [pins, flashToast, updateConfig])

  const onArrow = useCallback((providerId: string, direction: 'up' | 'down') => {
    const root = frame.current
    if (!root) return
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.provider-disclosure'))
    const index = buttons.findIndex(button => button.id === `provider-header-${providerId}`)
    if (index === -1) return
    const target = buttons[direction === 'down' ? index + 1 : index - 1]
    target?.focus()
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try { await Promise.all([window.tokmon.refresh('summary'), window.tokmon.refresh('billing')]) }
    catch { /* surfaced via connection state */ }
    finally { setNow(Date.now()); setTimeout(() => setRefreshing(false), 600) }
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editable = target?.matches('input, textarea, select, [contenteditable="true"]') === true
      if (event.key === 'Escape') {
        if (surface === 'theme' || surface === 'desktop' || surface === 'detection') setSurface('settings')
        else if (surface === 'settings') setSurface('usage')
        else window.close()
        return
      }
      if (config && matchesPrivacyShortcut({
        key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey,
        shiftKey: event.shiftKey, repeat: event.repeat, editable,
      }, config.privacyToggleKey)) {
        event.preventDefault()
        const optimistic = updateConfig(next => ({ ...next, privacyMode: !next.privacyMode }))
        const nextPrivacy = optimistic?.privacyMode ?? !config.privacyMode
        flashToast(nextPrivacy ? 'Privacy on — account identities hidden.' : 'Privacy off — account identities shown.')
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault(); setSurface('settings'); return
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault()
        void refresh()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [refresh, surface, config, updateConfig, flashToast])

  const openDashboard = useCallback((path?: DashboardPath) => { void window.tokmon.openDashboard(path) }, [])

  const onSectionsScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    updateScrollEdges(event.currentTarget)
  }, [updateScrollEdges])

  const ready = snapshot && config
  const hasAccounts = (snapshot?.accounts.length ?? 0) > 0

  return (
    <main
      ref={frame} className={`popover connection-${state?.connection ?? 'connecting'}`}
      data-can-scroll-up={scrollEdges.up} data-can-scroll-down={scrollEdges.down}
      role="dialog" aria-label="Tokmon usage"
    >
      {!ready
        ? <ColdState state={state} />
        : surface === 'settings'
          ? <SettingsHub config={config} onBack={() => setSurface('usage')} onTheme={() => setSurface('theme')} onDesktop={() => setSurface('desktop')} onDetection={() => setSurface('detection')} />
        : surface === 'theme'
          ? <ThemeSettings config={config} systemMode={state?.systemMode ?? 'dark'} onPatch={mutate => { void updateConfig(mutate) }} onBack={() => setSurface('settings')} onDashboard={() => openDashboard('/settings')} />
        : surface === 'desktop'
          ? <DesktopSettings config={config} groups={groups} onPatch={mutate => { void updateConfig(mutate) }} onBack={() => setSurface('settings')} onDashboard={() => openDashboard('/settings')} />
        : surface === 'detection'
          ? <DetectionSettings config={config} snapshot={snapshot} onPatch={mutate => { void updateConfig(mutate) }} onBack={() => setSurface('settings')} onDashboard={() => openDashboard('/settings')} />
        : !hasAccounts
          ? <EmptyState onDashboard={() => openDashboard('/settings')} />
          : (
            <>
              <div
                ref={sections} className="sections" onScroll={onSectionsScroll}
                data-can-scroll-up={scrollEdges.up} data-can-scroll-down={scrollEdges.down}
              >
                {groups.map(group => (
                  <ProviderCard
                    key={group.providerId} group={group} snapshot={snapshot} config={config}
                    pinned={pins.includes(group.providerId)} expanded={expanded.has(group.providerId)}
                    deny={denyProvider === group.providerId} refreshing={refreshing} now={now}
                    onToggle={() => onToggleProvider(group.providerId)}
                    onPin={() => onPinProvider(group.providerId)}
                    onArrow={direction => onArrow(group.providerId, direction)}
                  />
                ))}
                {pins.length === 0 && (
                  <p className="pin-hint">Pin up to {MAX_PINS} providers to the menu bar.</p>
                )}
              </div>
              <TrayStripPainter snapshot={snapshot} config={config} pins={pins} platform={state?.platform ?? ''} now={now} />
            </>
          )}
      <UpdateReady
        update={state?.update ?? { status: 'disabled', availableVersion: null, progressPercent: null, error: null }}
        currentVersion={state?.appVersion ?? ''} onInstall={() => void window.tokmon.installUpdate()}
      />
      <Footer
        snapshot={snapshot} refreshing={refreshing} now={now}
        appName={state?.appName ?? 'Tokmon'} appVersion={state?.appVersion ?? ''}
        daemonRole={state?.daemonRole ?? null}
        onRefresh={() => void refresh()} onSettings={() => setSurface('settings')} onDashboard={() => openDashboard()}
      />
      {toast && <Toast message={toast} />}
    </main>
  )
}
