import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { setDetectedAccountExcluded, type Config, type WebAccount, type WebSnapshot } from '../../web/contract'
import type { DashboardPath, DesktopState } from '../shared/desktop-contract'
import { accountIdentity, matchesPrivacyShortcut } from './privacy'
import { initialExpandedProviders, writeExpandedProviders } from './disclosure-state'
import {
  groupByProvider,
  MAX_PINS,
  readProviderPins,
  resolveProviderPins,
  togglePin,
} from './presentation'
import { ProviderCard } from './provider-card'
import { ColdState, EmptyState, Footer, TotalsBar, UpdateReady } from './desktop-chrome'
import { DesktopSettings, MenuBarSettings, ProvidersSettings, SettingsHub, ThemeSettings } from './desktop-settings'
import { TrayStripPainter } from './tray-strip-painter'
import { OptimisticConfigUpdates } from './config-updates'
import { applyDesktopTheme } from './theme'
import { releasePopoverFocus } from './popover-focus'

function Toast({ message }: { message: string }) {
  return <div className="toast" role="status">{message}</div>
}

function accountHome(account: WebAccount): string {
  return account.homeDir?.trim() || '~'
}

/** Apply optimistic account policy to a lagging snapshot while the daemon reconciles. */
export function snapshotWithAccountPolicy(snapshot: WebSnapshot, config: Config): WebSnapshot {
  const configured = (account: WebAccount) => config.accounts.find(candidate =>
    candidate.id === account.id
      || (candidate.providerId === account.providerId && (candidate.homeDir.trim() || '~') === accountHome(account)),
  )
  const included = (account: WebAccount) => {
    if (config.disabledProviders.includes(account.providerId)) return false
    const manual = configured(account)
    if (account.source === 'configured' || (account.source === undefined && manual)) {
      return manual?.enabled !== false
    }
    if (!config.accountDetection.enabled
      || config.accountDetection.disabledProviders.includes(account.providerId)) return false
    return !config.accountDetection.excludedAccounts.some(ref =>
      ref.providerId === account.providerId && ref.homeDir === accountHome(account),
    )
  }
  const accounts = snapshot.accounts.filter(included)
  if (accounts.length === snapshot.accounts.length) return snapshot
  const count = (values: readonly WebAccount[], providerId: string) =>
    values.filter(account => account.providerId === providerId).length
  return {
    ...snapshot,
    accounts,
    providers: snapshot.providers.map(provider =>
      count(accounts, provider.id) === count(snapshot.accounts, provider.id)
        ? provider
        : { ...provider, headroom: undefined }),
  }
}

export function measuredPopoverHeight(contentHeight: number, chromeHeights: readonly number[]): number {
  return Math.ceil(contentHeight + chromeHeights.reduce((total, height) => total + height, 0))
}

export function pinProviderFromCard(
  pins: readonly string[],
  providerId: string,
  replaceSecond = false,
): { pins: string[]; rejected: boolean; replaced: boolean } {
  if (replaceSecond && !pins.includes(providerId) && pins.length >= MAX_PINS) {
    return { pins: [pins[0]!, providerId], rejected: false, replaced: true }
  }
  const result = togglePin(pins, providerId)
  return { ...result, replaced: false }
}

/** Keep disabled or temporarily unavailable providers in their saved slots. */
export function pinProviderPreservingStoredPins(
  storedPins: readonly string[],
  effectivePins: readonly string[],
  providerId: string,
  replaceSecond = false,
): { pins: string[]; rejected: boolean; replaced: boolean } {
  const uniqueStored = [...new Set(storedPins.filter(Boolean))].slice(0, MAX_PINS)
  return pinProviderFromCard(uniqueStored.length > 0 ? uniqueStored : effectivePins, providerId, replaceSecond)
}

// ── App ──────────────────────────────────────────────────────────────────────
export function App() {
  const [state, setState] = useState<DesktopState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [toast, setToast] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [surface, setSurface] = useState<'usage' | 'settings' | 'theme' | 'menubar' | 'providers' | 'desktop'>('usage')
  const [denyProvider, setDenyProvider] = useState<string | null>(null)
  const [scrollEdges, setScrollEdges] = useState({ up: false, down: false })
  const frame = useRef<HTMLDivElement>(null)
  const sections = useRef<HTMLDivElement>(null)
  const scrollAnchor = useRef<{ providerId: string; top: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const denyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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
    releasePopoverFocus(document.activeElement)
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
        const chrome = root.querySelectorAll<HTMLElement>('.totals, .update-ready, .footer')
        const contentHeight = content?.scrollHeight ?? root.scrollHeight
        const height = measuredPopoverHeight(contentHeight, [...chrome].map(element => element.offsetHeight))
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
  const effectiveSnapshot = useMemo(
    () => snapshot && config ? snapshotWithAccountPolicy(snapshot, config) : snapshot,
    [snapshot, config],
  )

  // Apply the shared palette before layout effects measure the popover. Theme
  // changes are an immediate root-level token swap, not a subtree observation
  // or animated repaint, so Auto follows the OS without disclosure lag.
  useLayoutEffect(() => {
    if (!config) return
    applyDesktopTheme(document.documentElement, config.appearance, state?.systemMode ?? 'dark')
  }, [config?.appearance, state?.systemMode])

  const groups = useMemo(() => (effectiveSnapshot ? groupByProvider(effectiveSnapshot) : []), [effectiveSnapshot])
  const pins = useMemo(
    () => (config && effectiveSnapshot ? resolveProviderPins(config, effectiveSnapshot) : []),
    [config, effectiveSnapshot],
  )
  const storedPins = useMemo(() => {
    if (!config) return pins
    const explicit = readProviderPins(config)
    return explicit.length > 0 ? [...new Set(explicit)].slice(0, MAX_PINS) : pins
  }, [config, pins])

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

  // Accordion disclosure is local UI state. The daemon field is read only as a
  // one-time compatibility seed for users upgrading from older desktop builds.
  useEffect(() => {
    if (seeded.current || !config || !snapshot || groups.length === 0) return
    seeded.current = true
    const providerIds = new Set(groups.map(group => group.providerId))
    const initial = initialExpandedProviders(
      window.localStorage,
      providerIds,
      config.desktop?.expandedProviders ?? [],
      groups.length === 1 ? groups[0]!.providerId : null,
    )
    setExpanded(new Set(initial))
    try { writeExpandedProviders(window.localStorage, initial, providerIds) } catch {}
  }, [config, snapshot, groups])

  const persistExpansion = useCallback((next: Set<string>) => {
    const known = new Set(groups.map(group => group.providerId))
    const ids = [...next].filter(id => known.has(id))
    try { writeExpandedProviders(window.localStorage, ids, known) } catch {}
  }, [groups])

  useEffect(() => () => {
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

  const onPinProvider = useCallback((providerId: string, replaceSecond = false) => {
    const result = pinProviderPreservingStoredPins(storedPins, pins, providerId, replaceSecond)
    if (result.replaced) {
      void updateConfig(next => ({
        ...next,
        tray: { ...next.tray, pinnedProviders: result.pins, pins: [], pinnedAccount: null },
      }))
      const name = groups.find(group => group.providerId === providerId)?.name ?? providerId
      flashToast(`${name} replaced menu bar position 2.`)
      return
    }
    if (result.rejected) {
      flashToast(`Up to ${MAX_PINS} providers. Option-click to replace position 2.`)
      setDenyProvider(providerId)
      clearTimeout(denyTimer.current)
      denyTimer.current = setTimeout(() => setDenyProvider(null), 360)
      return
    }
    void updateConfig(next => ({
      ...next,
      tray: { ...next.tray, pinnedProviders: result.pins, pins: [], pinnedAccount: null },
    }))
  }, [storedPins, pins, groups, flashToast, updateConfig])

  const removeDetectedAccount = useCallback((account: WebAccount) => {
    void updateConfig(next => ({
      ...next,
      activeAccountId: next.activeAccountId === account.id ? null : next.activeAccountId,
      accountDetection: setDetectedAccountExcluded(next.accountDetection, {
        providerId: account.providerId,
        homeDir: accountHome(account),
      }, true),
    }))
    flashToast(`${accountIdentity(account, config?.privacyMode ?? true)} removed from Tokmon. Restore it in Providers & Accounts.`)
  }, [config?.privacyMode, flashToast, updateConfig])

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
        if (surface === 'theme' || surface === 'menubar' || surface === 'providers' || surface === 'desktop') setSurface('settings')
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

  const checkForUpdates = useCallback(async () => {
    try { await window.tokmon.checkForUpdates() }
    catch { flashToast('Couldn’t check for updates. Try again.') }
  }, [flashToast])

  const onSectionsScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    updateScrollEdges(event.currentTarget)
  }, [updateScrollEdges])

  const ready = effectiveSnapshot && config
  const hasAccounts = (effectiveSnapshot?.accounts.length ?? 0) > 0
  const displayWidthPt = state?.displayWidthPt ?? window.screen?.availWidth ?? 1440
  const updateState = state?.update ?? { status: 'disabled' as const, availableVersion: null, progressPercent: null, error: null }

  return (
    <main
      ref={frame} className={`popover connection-${state?.connection ?? 'connecting'}`}
      data-can-scroll-up={scrollEdges.up} data-can-scroll-down={scrollEdges.down}
      role="dialog" aria-label="Tokmon usage"
    >
      {ready && (
        <TrayStripPainter
          snapshot={effectiveSnapshot} config={config} pins={pins} platform={state?.platform ?? ''}
          update={updateState} displayWidthPt={displayWidthPt}
        />
      )}
      {!ready
        ? <ColdState state={state} />
        : surface === 'settings'
          ? <SettingsHub
              config={config} onBack={() => setSurface('usage')}
              onTheme={() => setSurface('theme')} onMenuBar={() => setSurface('menubar')}
              onProviders={() => setSurface('providers')} onDesktop={() => setSurface('desktop')}
            />
        : surface === 'theme'
          ? <ThemeSettings config={config} systemMode={state?.systemMode ?? 'dark'} onPatch={mutate => { void updateConfig(mutate) }} onBack={() => setSurface('settings')} onDashboard={() => openDashboard('/settings')} />
        : surface === 'menubar'
          ? <MenuBarSettings
              config={config} snapshot={effectiveSnapshot} pins={pins} platform={state?.platform ?? ''}
              displayWidthPt={displayWidthPt} update={updateState}
              onPatch={mutate => { void updateConfig(mutate) }} onBack={() => setSurface('settings')}
              onToast={flashToast}
            />
        : surface === 'desktop'
          ? <DesktopSettings
              config={config}
              update={state?.update ?? { status: 'disabled', availableVersion: null, progressPercent: null, error: null }}
              loginItem={state?.loginItem ?? { status: 'development', enabled: false, error: null }}
              appVersion={state?.appVersion ?? ''}
              daemon={state?.daemon ?? null}
              onPatch={mutate => { void updateConfig(mutate) }}
              onBack={() => setSurface('settings')} onDashboard={() => openDashboard('/settings')}
              onCheckUpdates={() => { void checkForUpdates() }}
              onQuit={() => { void window.tokmon.quit() }}
            />
        : surface === 'providers'
          // Deliberately the raw snapshot, not effectiveSnapshot: this panel must
          // see pre-filter truth so a removed account renders as Removed instead
          // of vanishing from the list that manages it. Non-null is safe under !ready.
          ? <ProvidersSettings config={config} snapshot={snapshot!} onPatch={mutate => { void updateConfig(mutate) }} onBack={() => setSurface('settings')} onDashboard={() => openDashboard('/settings/accounts')} />
        : !hasAccounts
          ? <EmptyState onDashboard={() => openDashboard('/settings/accounts')} />
          : (
            <>
              <div
                ref={sections} className="sections" onScroll={onSectionsScroll}
                data-can-scroll-up={scrollEdges.up} data-can-scroll-down={scrollEdges.down}
              >
                {groups.map(group => (
                  <ProviderCard
                    key={group.providerId} group={group} snapshot={effectiveSnapshot} config={config}
                    pinned={pins.includes(group.providerId)} pinPosition={pins.indexOf(group.providerId) >= 0 ? pins.indexOf(group.providerId) + 1 : null}
                    pinCount={storedPins.length}
                    expanded={expanded.has(group.providerId)}
                    deny={denyProvider === group.providerId} refreshing={refreshing} now={now}
                    onToggle={() => onToggleProvider(group.providerId)}
                    onPin={replaceSecond => onPinProvider(group.providerId, replaceSecond)}
                    onArrow={direction => onArrow(group.providerId, direction)}
                    onRemoveAccount={removeDetectedAccount}
                  />
                ))}
                {pins.length === 0 && (
                  <p className="pin-hint">Pin up to {MAX_PINS} providers to the menu bar.</p>
                )}
              </div>
            </>
          )}
      {surface === 'usage' && effectiveSnapshot && <TotalsBar snapshot={effectiveSnapshot} now={now} />}
      <UpdateReady
        update={updateState}
        currentVersion={state?.appVersion ?? ''}
        onInstall={() => void window.tokmon.installUpdate()}
        onCheck={() => void window.tokmon.checkForUpdates()}
      />
      <Footer
        snapshot={snapshot} refreshing={refreshing} now={now}
        appName={state?.appName ?? 'Tokmon'} appVersion={state?.appVersion ?? ''}
        daemon={state?.daemon ?? null}
        onRefresh={() => void refresh()} onSettings={() => setSurface('settings')} onDashboard={() => openDashboard()}
      />
      {toast && <Toast message={toast} />}
    </main>
  )
}
