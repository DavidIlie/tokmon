import React from 'react'
import {
  PROVIDER_META,
  PROVIDER_ORDER,
  DESKTOP_GRAPH_RANGES,
  DEFAULT_MENU_BAR_CONFIG,
  providerDetectionEnabled,
  setDetectedAccountExcluded,
  setProviderDetectionEnabled,
  setProviderTrackingEnabled,
  type Config,
  type MenuBarDensity,
  type WebSnapshot,
} from '../../web/contract'
import type { DesktopState, DesktopUpdateState } from '../shared/desktop-contract'
import { snapshotUsageTotals, totalsCopy, usageDataStatus } from '../shared/presentation'
import {
  isBuiltInThemePreset,
  isDarkOnlyThemePreset,
  resolveTheme,
  THEME_PRESET_OPTIONS,
  themePresetOption,
  type AppearanceConfig,
  type ThemePreset,
} from '../../theme'
import { MenuBarStripPreview, menuBarValues } from './tray-strip-painter'
import { menuBarWidthBudget, type MenuBarPlan } from '../shared/menu-bar-plan'

type PreviewStyle = React.CSSProperties & Record<'--preview-bg' | '--preview-accent' | '--preview-cost' | '--preview-dim', string>

function themePreviewStyle(appearance: AppearanceConfig, preset: ThemePreset, systemMode: 'light' | 'dark'): PreviewStyle {
  const tokens = resolveTheme({ ...appearance, preset }, systemMode).tokens
  return {
    '--preview-bg': tokens.panel,
    '--preview-accent': tokens.accent,
    '--preview-cost': tokens.cost,
    '--preview-dim': tokens.textDim,
  }
}

function updatedLabel(snapshot: WebSnapshot | null, now: number): string {
  if (!snapshot) return 'Waiting…'
  const seconds = Math.max(0, Math.round((now - snapshot.generatedAt) / 1000))
  if (seconds < 15) return 'Updated just now'
  if (seconds < 60) return `Updated ${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `Updated ${minutes}m ago`
  return `Updated ${Math.round(minutes / 60)}h ago`
}

function SettingsIcon() {
  return <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true"><path d="M6.8 1.5h2.4l.35 1.45c.35.12.68.26.98.45l1.28-.77 1.7 1.7-.77 1.28c.19.3.33.63.45.98L14.5 7v2l-1.31.4c-.12.35-.26.68-.45.98l.77 1.28-1.7 1.7-1.28-.77c-.3.19-.63.33-.98.45L9.2 14.5H6.8l-.35-1.46a5 5 0 0 1-.98-.45l-1.28.77-1.7-1.7.77-1.28a5 5 0 0 1-.45-.98L1.5 9V7l1.31-.4c.12-.35.26-.68.45-.98l-.77-1.28 1.7-1.7 1.28.77c.3-.19.63-.33.98-.45L6.8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.15"/></svg>
}

function daemonLabel(daemon: DesktopState['daemon']): string | null {
  if (!daemon) return null
  const owner = daemon.role === 'owner' ? 'this app' : daemon.ownerKind === 'cli' ? 'CLI' : 'desktop app'
  return `Background service ${daemon.version} · protocol ${daemon.protocolVersion} · ${owner}`
}

export function Footer({ snapshot, refreshing, now, appName, appVersion, daemon, onRefresh, onSettings, onDashboard }: {
  snapshot: WebSnapshot | null; refreshing: boolean; now: number
  appName: string; appVersion: string; daemon: DesktopState['daemon']
  onRefresh(): void; onSettings(): void; onDashboard(): void
}) {
  const freshness = refreshing ? 'Refreshing…' : updatedLabel(snapshot, now)
  const service = daemonLabel(daemon)
  return (
    <footer className="footer">
      <div className="footer-status">
        <button
          type="button" className="footer-refresh" title="Refresh now (⌘R)"
          aria-label={`${freshness}. Refresh now`} onClick={onRefresh}
        >
          {freshness}
        </button>
        {appVersion && (
          <span
            className="footer-app"
            title={`Version ${appVersion}${service ? ` · ${service}` : ''}`}
            aria-label={`${appName} version ${appVersion}${service ? `, ${service}` : ''}`}
          >
            <span aria-hidden="true">{appName} {appVersion}{daemon?.role === 'attached' ? ' · CLI service' : ''}</span>
          </span>
        )}
      </div>
      <span className="footer-actions">
        <button type="button" className="footer-settings" title="Desktop settings (⌘,)" aria-label="Desktop settings" onClick={onSettings}><SettingsIcon /></button>
        <button type="button" className="footer-dashboard" onClick={onDashboard}>Open Dashboard</button>
      </span>
    </footer>
  )
}

export function TotalsBar({ snapshot, now }: { snapshot: WebSnapshot; now: number }) {
  const totals = snapshotUsageTotals(snapshot)
  if (!totals) return null
  const status = usageDataStatus(totals.accounts, snapshot.intervalMs, now)
  if (!totals.dashboard) {
    return (
      <aside className="totals" data-state="loading" role="status" aria-label="Cross-provider usage totals are loading">
        <span className="totals-primary">Usage totals</span>
        <span className="totals-secondary">Reading usage…</span>
      </aside>
    )
  }
  const copy = totalsCopy(totals.dashboard)
  const detail = status ? `${copy.title}; ${status}` : copy.title
  const warning = status?.startsWith('Partial') ? 'Partial' : status ? 'Stale' : null
  const state = warning?.toLowerCase() ?? 'ready'
  return (
    <aside className="totals" data-state={state} title={detail} aria-label={`${copy.ariaLabel}${status ? ` ${status}.` : ''}`}>
      <span className="totals-primary">{copy.primary}</span>
      {warning && <span className="totals-warning" aria-hidden="true">{warning}</span>}
      <span className="totals-secondary">{copy.secondary}</span>
    </aside>
  )
}

export function UpdateReady({ update, currentVersion, onInstall, onCheck = () => {} }: {
  update: DesktopUpdateState; currentVersion: string; onInstall(): void; onCheck?(): void
}) {
  if (update.status === 'error') {
    return (
      <aside className="update-ready" data-state="error" role="alert">
        <span className="update-copy">
          <strong>Update couldn’t finish</strong>
          <small>{update.error ?? 'Check for updates again to retry.'}</small>
        </span>
        <button type="button" onClick={onCheck}>Check Again</button>
      </aside>
    )
  }
  if (!['available', 'downloading', 'downloaded', 'restarting'].includes(update.status) || !update.availableVersion) return null
  const progress = update.progressPercent === null ? null : Math.round(update.progressPercent)
  const content = update.status === 'available'
    ? { title: `Preparing Tokmon ${update.availableVersion}…`, detail: 'Starting download' }
    : update.status === 'downloading'
      ? { title: `Downloading Tokmon ${update.availableVersion}…`, detail: progress === null ? 'Downloading…' : `${progress}%` }
      : update.status === 'restarting'
        ? { title: `Restarting to install Tokmon ${update.availableVersion}…`, detail: 'Closing the background service safely' }
        : { title: `Tokmon ${update.availableVersion} is ready`, detail: `Current version ${currentVersion}` }
  return (
    <aside className="update-ready" data-state={update.status} role="status" aria-live="polite" aria-label={`${content.title} ${content.detail}`}>
      <span className="update-copy">
        <strong>{content.title}</strong>
        <small>{content.detail}</small>
      </span>
      {update.status === 'downloaded' && <button type="button" onClick={onInstall}>Restart to Install</button>}
      {(update.status === 'available' || update.status === 'downloading') && (
        <span className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}>
          <span style={{ width: `${progress ?? 4}%` }} />
        </span>
      )}
    </aside>
  )
}

function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="settings-row"><span><b>{label}</b>{hint && <small>{hint}</small>}</span><span className="settings-control">{children}</span></div>
}

function Toggle({ value, onChange, label, disabled = false, title }: {
  value: boolean
  onChange(value: boolean): void
  label: string
  disabled?: boolean
  title?: string
}) {
  return <button
    type="button" className="toggle" data-on={value} role="switch" aria-checked={value}
    aria-label={label} disabled={disabled} title={title} onClick={() => onChange(!value)}
  ><span /></button>
}

function SettingsHeader({ title, backLabel, onBack }: { title: string; backLabel: string; onBack(): void }) {
  return (
    <header className="settings-header">
      <button type="button" className="settings-back" aria-label={`Back to ${backLabel}`} onClick={onBack}>‹ {backLabel}</button>
      <strong>{title}</strong>
    </header>
  )
}

export function SettingsHub({ config, onBack, onTheme, onMenuBar, onProviders, onDesktop }: {
  config: Config
  onBack(): void
  onTheme(): void
  onMenuBar(): void
  onProviders(): void
  onDesktop(): void
}) {
  const preset = themePresetOption(config.appearance.preset).name
  const mode = isDarkOnlyThemePreset(config.appearance.preset)
    ? 'Dark'
    : config.appearance.mode === 'auto' ? 'Auto' : config.appearance.mode === 'light' ? 'Light' : 'Dark'
  return (
    <section className="settings-view" aria-label="Settings">
      <SettingsHeader title="Settings" backLabel="Usage" onBack={onBack} />
      <nav className="settings-hub" aria-label="Settings sections">
        <button type="button" className="settings-destination" onClick={onTheme}>
          <span className="theme-orbit" style={themePreviewStyle(config.appearance, config.appearance.preset, 'dark')} aria-hidden="true"><i /><i /><i /></span>
          <span><b>Theme</b><small>{preset} · {mode}</small></span>
          <span className="destination-chevron" aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-destination" onClick={onMenuBar}>
          <span className="menubar-glyph" aria-hidden="true"><i /><i /></span>
          <span><b>Menu Bar</b><small>Content, spacing, and compact screens</small></span>
          <span className="destination-chevron" aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-destination" onClick={onProviders}>
          <span className="detection-glyph" aria-hidden="true"><i /><i /></span>
          <span><b>Providers &amp; Accounts</b><small>{config.accountDetection.enabled ? 'Automatic discovery on' : 'Manual accounts only'} · {config.accountDetection.excludedAccounts.length} ignored</small></span>
          <span className="destination-chevron" aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-destination" onClick={onDesktop}>
          <span className="desktop-glyph" aria-hidden="true"><i /></span>
          <span><b>Desktop App</b><small>Privacy, cards, startup, and updates</small></span>
          <span className="destination-chevron" aria-hidden="true">›</span>
        </button>
      </nav>
    </section>
  )
}

const MODES: ReadonlyArray<{ value: AppearanceConfig['mode']; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function ThemeSettings({ config, systemMode, onPatch, onBack, onDashboard }: {
  config: Config
  systemMode: 'light' | 'dark'
  onPatch(mutate: (config: Config) => Config): void
  onBack(): void
  onDashboard(): void
}) {
  const appearance = config.appearance
  const darkOnly = isDarkOnlyThemePreset(appearance.preset)
  const shownMode = darkOnly ? 'dark' : appearance.mode
  const selectPreset = (preset: ThemePreset) => onPatch(next => {
    const base = isBuiltInThemePreset(next.appearance.preset) ? next.appearance.preset : 'tokmon'
    return {
      ...next,
      appearance: {
        ...next.appearance,
        preset,
        ...(preset === 'custom' && !next.appearance.custom ? { custom: { base, light: {}, dark: {} } } : {}),
        ...(isDarkOnlyThemePreset(preset) ? { mode: 'dark' as const } : {}),
      },
    }
  })
  const movePresetFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = THEME_PRESET_OPTIONS.length - 1
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
      : event.key === 'ArrowRight' ? Math.min(last, index + 1)
      : event.key === 'ArrowUp' ? Math.max(0, index - 2)
      : event.key === 'ArrowDown' ? Math.min(last, index + 2)
      : null
    if (nextIndex === null || nextIndex === index) return
    event.preventDefault()
    const next = THEME_PRESET_OPTIONS[nextIndex]!
    selectPreset(next.id)
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-preset="${next.id}"]`)
      ?.focus()
  }
  return (
    <section className="settings-view" aria-label="Theme settings">
      <SettingsHeader title="Theme" backLabel="Settings" onBack={onBack} />
      <div className="settings-list theme-settings-list">
        <div className="theme-section">
          <div className="theme-section-copy"><b>Appearance</b><small>Auto is currently {systemMode}</small></div>
          <span className="segmented theme-mode" role="radiogroup" aria-label="Appearance mode">
            {MODES.map(option => {
              const unavailable = darkOnly && option.value !== 'dark'
              return <button
                key={option.value} type="button" role="radio" aria-checked={shownMode === option.value}
                data-active={shownMode === option.value}
                disabled={unavailable} aria-disabled={unavailable}
                title={unavailable ? 'Phosphor is dark only' : undefined}
                onClick={() => onPatch(next => ({ ...next, appearance: { ...next.appearance, mode: option.value } }))}
              >{option.label}</button>
            })}
          </span>
        </div>
        <div className="theme-presets" role="radiogroup" aria-label="Theme preset">
          {THEME_PRESET_OPTIONS.map((option, index) => (
            <button
              key={option.id} type="button" role="radio"
              aria-checked={appearance.preset === option.id}
              data-active={appearance.preset === option.id}
              data-preset={option.id}
              tabIndex={appearance.preset === option.id ? 0 : -1}
              onKeyDown={event => movePresetFocus(event, index)}
              onClick={() => selectPreset(option.id)}
            >
              <span className="theme-preview" style={themePreviewStyle(appearance, option.id, systemMode)} aria-hidden="true"><i /><i /><i /></span>
              <span><b>{option.name}</b><small>{option.hint}</small></span>
              <i className="theme-selected" aria-hidden="true" />
            </button>
          ))}
        </div>
        {darkOnly && <p className="theme-note">Phosphor stays dark so its contrast and terminal character remain intact.</p>}
      </div>
      <button type="button" className="manage-settings" onClick={onDashboard}>
        {isBuiltInThemePreset(appearance.preset) ? `Customize ${themePresetOption(appearance.preset).name} in Dashboard…` : 'Edit custom colors in Dashboard…'}
      </button>
    </section>
  )
}

const MENU_BAR_DENSITIES: ReadonlyArray<{ value: MenuBarDensity; label: string }> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
  { value: 'tight', label: 'Tight' },
]

export function setMenuBarElementVisibility(
  config: Config,
  key: keyof Config['tray']['menuBar']['elements'],
  value: boolean,
): Config {
  const enabled = Object.values(config.tray.menuBar.elements).filter(Boolean).length
  if (!value && config.tray.menuBar.elements[key] && enabled === 1) return config
  return {
    ...config,
    tray: {
      ...config.tray,
      menuBar: {
        ...config.tray.menuBar,
        elements: { ...config.tray.menuBar.elements, [key]: value },
      },
      ...(key === 'value' ? { showMenuBarText: value } : {}),
    },
  }
}

export function patchMenuBarPresentation(
  config: Config,
  patch: Partial<Omit<Config['tray']['menuBar'], 'elements' | 'customSpacing'>> & {
    elements?: Partial<Config['tray']['menuBar']['elements']>
    customSpacing?: Partial<Config['tray']['menuBar']['customSpacing']>
  },
): Config {
  return {
    ...config,
    tray: {
      ...config.tray,
      menuBar: {
        ...config.tray.menuBar,
        ...patch,
        elements: { ...config.tray.menuBar.elements, ...patch.elements },
        customSpacing: { ...config.tray.menuBar.customSpacing, ...patch.customSpacing },
      },
    },
  }
}

export function setMenuBarValue(config: Config, menuBarValue: Config['tray']['menuBarValue']): Config {
  return { ...config, tray: { ...config.tray, menuBarValue } }
}

export function resetMenuBarPresentation(config: Config): Config {
  return {
    ...config,
    tray: {
      ...config.tray,
      menuBar: {
        ...DEFAULT_MENU_BAR_CONFIG,
        elements: { ...DEFAULT_MENU_BAR_CONFIG.elements },
        customSpacing: { ...DEFAULT_MENU_BAR_CONFIG.customSpacing },
      },
      showMenuBarText: DEFAULT_MENU_BAR_CONFIG.elements.value,
    },
  }
}

function MenuBarStepper({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange(value: number): void
}) {
  const adjust = (delta: number) => onChange(Math.max(min, Math.min(max, Math.round((value + delta) * 2) / 2)))
  return (
    <div className="menubar-stepper">
      <span>{label}</span>
      <span className="stepper-control">
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => adjust(-0.5)}>−</button>
        <output aria-label={`${label} value`}>{value.toFixed(1)} pt</output>
        <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => adjust(0.5)}>+</button>
      </span>
    </div>
  )
}

export function MenuBarSettings({ config, snapshot, pins, platform, displayWidthPt, update, onPatch, onBack, onToast }: {
  config: Config
  snapshot: WebSnapshot
  pins: string[]
  platform: string
  displayWidthPt: number
  update: DesktopUpdateState
  onPatch(mutate: (config: Config) => Config): void
  onBack(): void
  onToast(message: string): void
}) {
  const [previewWidth, setPreviewWidth] = React.useState<number | null>(null)
  const [previewPlan, setPreviewPlan] = React.useState<MenuBarPlan | null>(null)
  const previewStrip = React.useRef<HTMLSpanElement>(null)
  const menuBar = config.tray.menuBar
  const values = menuBarValues(snapshot, config, pins)
  const enabledElements = Object.values(menuBar.elements).filter(Boolean).length
  React.useEffect(() => {
    const canvas = previewStrip.current?.querySelector('canvas')
    if (!canvas) { setPreviewWidth(null); return }
    const measure = () => setPreviewWidth(Number.parseFloat(canvas.style.width) || canvas.getBoundingClientRect().width || null)
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    measure()
    return () => observer.disconnect()
  }, [values.length, menuBar, displayWidthPt, update.status])
  const setElement = (key: keyof Config['tray']['menuBar']['elements'], value: boolean) => {
    if (!value && menuBar.elements[key] && enabledElements === 1) {
      onToast('Keep at least one menu bar element visible.')
      return
    }
    onPatch(next => setMenuBarElementVisibility(next, key, value))
  }
  const setSpacing = (key: keyof Config['tray']['menuBar']['customSpacing'], value: number) => onPatch(next => (
    patchMenuBarPresentation(next, { customSpacing: { [key]: value } })
  ))
  const reset = () => onPatch(resetMenuBarPresentation)
  const platformNote = platform === 'darwin'
    ? 'Changes appear in the macOS menu bar immediately.'
    : 'The composed strip is a macOS feature. These preferences are saved for your Macs.'
  const adaptiveNote = menuBar.mode === 'auto' && previewPlan?.collapsed
    ? 'Auto simplified this strip to fit the current display.'
    : menuBar.mode === 'custom' && previewPlan && previewPlan.width > menuBarWidthBudget(displayWidthPt)
      ? 'This custom strip is wider than Tokmon’s compact-display budget.'
      : null
  return (
    <section className="settings-view menubar-settings" aria-label="Menu bar settings">
      <SettingsHeader title="Menu Bar" backLabel="Settings" onBack={onBack} />
      <div className="menubar-preview-stage" aria-label="Live menu bar preview">
        <div className="menubar-preview-band">
          <span ref={previewStrip} className="menubar-preview-bracket" data-empty={pins.length === 0 || undefined}>
            {pins.length === 0
              ? <span className="menubar-preview-empty"><i aria-hidden="true" />Pin a provider from Usage</span>
              : <MenuBarStripPreview
                  values={values} menuBar={menuBar} displayWidthPt={displayWidthPt}
                  updateReady={update.status === 'downloaded'} className="menubar-live-preview"
                  ariaLabel={`Tokmon menu bar preview with ${pins.length} pinned provider${pins.length === 1 ? '' : 's'}`}
                  onPlan={setPreviewPlan}
                />}
          </span>
          <span className="menubar-preview-system" aria-hidden="true"><i /><i /><i /></span>
        </div>
        <span className="menubar-preview-width">{previewWidth === null ? '—' : previewWidth.toFixed(1)} pt</span>
      </div>
      <p className="menubar-preview-caption">macOS reserves the outer spacing. Tokmon controls everything inside the bracket.</p>
      <div className="settings-list menubar-controls">
        <p className="settings-platform-note">{platformNote}</p>
        {adaptiveNote && <p className="menubar-adaptive-note" role="status">{adaptiveNote}</p>}
        <SettingsRow label="Layout" hint={menuBar.mode === 'auto' ? 'Can simplify on compact displays' : 'Renders your chosen elements'}>
          <span className="segmented" role="radiogroup" aria-label="Menu bar layout mode">
            {(['auto', 'custom'] as const).map(mode => <button
              key={mode} type="button" role="radio" aria-checked={menuBar.mode === mode}
              data-active={menuBar.mode === mode}
              onClick={() => onPatch(next => patchMenuBarPresentation(next, { mode }))}
            >{mode === 'auto' ? 'Auto' : 'Custom'}</button>)}
          </span>
        </SettingsRow>
        <div className="menubar-element-group" aria-label="Menu bar elements">
          {([
            ['providerMark', 'Provider mark'],
            ['value', 'Value'],
            ['progress', 'Progress'],
          ] as const).map(([key, label]) => {
            const lastVisible = menuBar.elements[key] && enabledElements === 1
            return <SettingsRow key={key} label={label} hint={key === 'progress' ? 'A quiet usage line below each provider' : undefined}>
              <Toggle
                value={menuBar.elements[key]} label={`Show ${label.toLowerCase()}`}
                disabled={lastVisible}
                title={lastVisible ? 'Keep at least one menu bar element visible' : undefined}
                onChange={value => setElement(key, value)}
              />
            </SettingsRow>
          })}
        </div>
        <SettingsRow label="Menu bar content" hint="What the menu bar number represents">
          <span className="segmented" role="radiogroup" aria-label="Menu bar value">
            <button type="button" role="radio" aria-checked={config.tray.menuBarValue === 'usage'} data-active={config.tray.menuBarValue === 'usage'} onClick={() => onPatch(next => setMenuBarValue(next, 'usage'))}>Usage</button>
            <button type="button" role="radio" aria-checked={config.tray.menuBarValue === 'todayTokens'} data-active={config.tray.menuBarValue === 'todayTokens'} onClick={() => onPatch(next => setMenuBarValue(next, 'todayTokens'))}>Tokens today</button>
          </span>
        </SettingsRow>
        <SettingsRow label="Density" hint={menuBar.mode === 'custom' ? 'Icon and text size' : 'Baseline spacing between elements'}>
          <span className="segmented menubar-density" role="radiogroup" aria-label="Menu bar density">
            {MENU_BAR_DENSITIES.map(option => <button
              key={option.value} type="button" role="radio" aria-checked={menuBar.density === option.value}
              data-active={menuBar.density === option.value}
              onClick={() => onPatch(next => patchMenuBarPresentation(next, { density: option.value }))}
            >{option.label}</button>)}
          </span>
        </SettingsRow>
        {menuBar.mode === 'custom' && (
          <div className="menubar-spacing" aria-label="Custom menu bar spacing">
            <MenuBarStepper label="Edge" value={menuBar.customSpacing.edgePaddingPt} min={0} max={6} onChange={value => setSpacing('edgePaddingPt', value)} />
            <MenuBarStepper label="Mark to value" value={menuBar.customSpacing.markValueGapPt} min={0} max={8} onChange={value => setSpacing('markValueGapPt', value)} />
            <MenuBarStepper label="Between providers" value={menuBar.customSpacing.providerGapPt} min={0} max={16} onChange={value => setSpacing('providerGapPt', value)} />
          </div>
        )}
        <div className="menubar-reset-row">
          <span>Provider pins stay in their left-to-right order.</span>
          <button type="button" onClick={reset}>Reset Menu Bar</button>
        </div>
      </div>
    </section>
  )
}

function updateStatusCopy(update: DesktopUpdateState): string {
  if (update.status === 'disabled') return 'Automatic updates are available in the installed app'
  if (update.status === 'unsupported') return 'Updates for this Linux package are managed by your package manager'
  if (update.status === 'checking') return 'Looking for a newer version…'
  if (update.status === 'available' || update.status === 'downloading') {
    const progress = update.progressPercent === null ? '' : ` · ${Math.round(update.progressPercent)}%`
    return `Downloading${update.availableVersion ? ` ${update.availableVersion}` : ''}${progress}`
  }
  if (update.status === 'downloaded') return `${update.availableVersion ?? 'An update'} is ready to install`
  if (update.status === 'restarting') return `Restarting to install ${update.availableVersion ?? 'the update'}…`
  if (update.status === 'error') return update.error ?? 'The last update failed · Try again'
  return 'Checks automatically after launch and every hour'
}

export function DesktopSettings({ config, update, appVersion, daemon, onPatch, onBack, onDashboard, onCheckUpdates, onQuit }: {
  config: Config
  update: DesktopUpdateState
  appVersion: string
  daemon: DesktopState['daemon']
  onPatch(mutate: (config: Config) => Config): void
  onBack(): void
  onDashboard(): void
  onCheckUpdates(): void
  onQuit(): void
}) {
  const service = daemonLabel(daemon)
  const updateBusy = update.status === 'checking' || update.status === 'available' || update.status === 'downloading' || update.status === 'restarting'
  const updateDisabled = update.status === 'disabled' || update.status === 'unsupported' || updateBusy || update.status === 'downloaded'
  const updateLabel = update.status === 'restarting'
    ? 'Restarting…'
    : update.status === 'downloaded'
    ? 'Update Ready'
    : update.status === 'unsupported'
      ? 'Use Package Manager'
    : update.status === 'checking'
      ? 'Checking…'
      : update.status === 'available' || update.status === 'downloading'
        ? `Downloading${update.progressPercent === null ? '…' : ` ${Math.round(update.progressPercent)}%`}`
        : update.status === 'error' ? 'Try Again' : 'Check for Updates'
  return (
    <section className="settings-view" aria-label="Desktop settings">
      <SettingsHeader title="Desktop App" backLabel="Settings" onBack={onBack} />
      <div className="settings-list">
        <SettingsRow label="Privacy mode" hint={`Hide account identity · ${config.privacyToggleKey.toUpperCase()}`}>
          <Toggle value={config.privacyMode} label="Privacy mode" onChange={value => onPatch(next => ({ ...next, privacyMode: value }))} />
        </SettingsRow>
        <SettingsRow label="Provider summary" hint="Smart pools accounts · highest usage shows one account">
          <span className="segmented" role="radiogroup" aria-label="Provider summary">
            <button type="button" role="radio" aria-checked={config.tray.displayMetric === 'smartHeadroom'} data-active={config.tray.displayMetric === 'smartHeadroom'} onClick={() => onPatch(next => ({ ...next, tray: { ...next.tray, displayMetric: 'smartHeadroom' } }))}>Smart</button>
            <button type="button" role="radio" aria-checked={config.tray.displayMetric === 'tightestRemaining'} data-active={config.tray.displayMetric === 'tightestRemaining'} onClick={() => onPatch(next => ({ ...next, tray: { ...next.tray, displayMetric: 'tightestRemaining' } }))}>Highest usage</button>
          </span>
        </SettingsRow>
        <SettingsRow label="Graph range" hint="Trailing spend activity">
          <span className="segmented" role="radiogroup" aria-label="Graph range">
            {DESKTOP_GRAPH_RANGES.map(value => <button
              key={value} type="button" role="radio" aria-checked={config.desktop.graphRangeDays === value}
              data-active={config.desktop.graphRangeDays === value}
              onClick={() => onPatch(next => ({ ...next, desktop: { ...next.desktop, graphRangeDays: value } }))}
            >{value}d</button>)}
          </span>
        </SettingsRow>
        <SettingsRow label="Active window" hint="Recent usage emphasis">
          <span className="segmented" role="radiogroup" aria-label="Active window">{[5, 10, 20, 30].map(value => <button key={value} type="button" role="radio" aria-checked={config.tray.activeTimeoutMin === value} data-active={config.tray.activeTimeoutMin === value} onClick={() => onPatch(next => ({ ...next, tray: { ...next.tray, activeTimeoutMin: value } }))}>{value}m</button>)}</span>
        </SettingsRow>
        <SettingsRow label="Launch at login" hint="Start Tokmon silently">
          <Toggle value={config.tray.launchAtLogin} label="Launch at login" onChange={value => onPatch(next => ({ ...next, tray: { ...next.tray, launchAtLogin: value } }))} />
        </SettingsRow>
        <div className="desktop-app-actions" aria-label="Application actions">
          <span className="desktop-app-version">
            <b>Tokmon {appVersion}</b>
            <small>{updateStatusCopy(update)}</small>
            {service && <small>{service}</small>}
          </span>
          <span className="desktop-action-buttons">
            <button
              type="button" className="check-updates" disabled={updateDisabled}
              onClick={onCheckUpdates}
            >{updateLabel}</button>
            <button type="button" className="quit-tokmon" onClick={onQuit}>Quit Tokmon</button>
          </span>
        </div>
      </div>
      <button type="button" className="manage-settings" onClick={onDashboard}>Manage all settings…</button>
    </section>
  )
}

export function ProvidersSettings({ config, snapshot, onPatch, onBack, onDashboard }: {
  config: Config
  snapshot: WebSnapshot
  onPatch(mutate: (config: Config) => Config): void
  onBack(): void
  onDashboard(): void
}) {
  const manualKeys = new Set(config.accounts.map(account => `${account.providerId}:${account.homeDir || '~'}`))
  const detected = snapshot.accounts.filter(account => {
    const homeDir = account.homeDir ?? '~'
    return !manualKeys.has(`${account.providerId}:${homeDir}`) && !config.accounts.some(manual => manual.id === account.id)
  })
  return (
    <section className="settings-view" aria-label="Providers and accounts settings">
      <SettingsHeader title="Providers & Accounts" backLabel="Settings" onBack={onBack} />
      <div className="settings-list">
        <div className="settings-subsection">
          <span><b>Track these providers</b><small>Turn a provider off everywhere without deleting its accounts, pins, or card preferences.</small></span>
          <div className="provider-switches">
            {PROVIDER_ORDER.map(providerId => {
              const enabled = !config.disabledProviders.includes(providerId)
              const name = PROVIDER_META[providerId].name
              return <div key={providerId}>
                <span>{name}</span>
                <Toggle
                  value={enabled} label={`Track ${name}`}
                  onChange={value => onPatch(next => setProviderTrackingEnabled(next, providerId, value))}
                />
              </div>
            })}
          </div>
        </div>
        <div className="settings-subsection-heading">
          <b>Automatic discovery</b>
          <small>Discovery finds local accounts. It does not control whether a provider is tracked.</small>
        </div>
        <SettingsRow label="Discover accounts" hint="Manual accounts keep working when this is off">
          <Toggle
            value={config.accountDetection.enabled}
            label="Discover accounts"
            onChange={enabled => onPatch(next => ({ ...next, accountDetection: { ...next.accountDetection, enabled } }))}
          />
        </SettingsRow>
        <SettingsRow label="Provider detectors" hint="Choose where Tokmon searches automatically">
          <span className="provider-chips" role="group" aria-label="Provider detectors">
            {PROVIDER_ORDER.map(providerId => {
              const enabled = providerDetectionEnabled(config.accountDetection, providerId)
              return <button
                key={providerId} type="button" aria-pressed={enabled} data-active={enabled}
                disabled={!config.accountDetection.enabled}
                onClick={() => onPatch(next => ({
                  ...next,
                  accountDetection: setProviderDetectionEnabled(next.accountDetection, providerId, !enabled),
                }))}
              >{PROVIDER_META[providerId].name}</button>
            })}
          </span>
        </SettingsRow>
        {(detected.length > 0 || config.accountDetection.excludedAccounts.length > 0) && (
          <div className="detection-accounts">
            {detected.map(account => (
              <div key={`${account.providerId}:${account.homeDir ?? '~'}`}>
                <span><b>{PROVIDER_META[account.providerId].name}</b><small>{config.privacyMode ? 'Path hidden' : account.homeDir ?? '~'}</small></span>
                <button type="button" onClick={() => onPatch(next => ({
                  ...next,
                  activeAccountId: next.activeAccountId === account.id ? null : next.activeAccountId,
                  accountDetection: setDetectedAccountExcluded(next.accountDetection, {
                    providerId: account.providerId,
                    homeDir: account.homeDir ?? '~',
                  }, true),
                }))}>Turn off</button>
              </div>
            ))}
            {config.accountDetection.excludedAccounts.map(ref => (
              <div key={`ignored:${ref.providerId}:${ref.homeDir}`} data-ignored="true">
                <span><b>{PROVIDER_META[ref.providerId].name}</b><small>{config.privacyMode ? 'Path hidden' : ref.homeDir}</small></span>
                <button type="button" onClick={() => onPatch(next => ({
                  ...next,
                  accountDetection: setDetectedAccountExcluded(next.accountDetection, ref, false),
                }))}>Turn on</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="manage-settings" onClick={onDashboard}>Manage manual accounts…</button>
    </section>
  )
}

export function ColdState({ state }: { state: DesktopState | null }) {
  const failed = state?.connection === 'error'
  const reconnecting = state?.connection === 'reconnecting'
  return (
    <section className="cold" aria-live="polite">
      <strong>{failed ? 'Background service unavailable' : reconnecting ? 'Reconnecting…' : 'Connecting to Tokmon…'}</strong>
      {failed && <span>{state?.error ?? 'Tokmon could not start its background service.'}</span>}
      {(failed || reconnecting) && (
        <button type="button" className="cold-retry" onClick={() => void window.tokmon.retryConnection()}>Retry</button>
      )}
    </section>
  )
}

export function EmptyState({ onDashboard }: { onDashboard(): void }) {
  return (
    <section className="cold">
      <strong>No accounts configured.</strong>
      <button type="button" className="cold-retry" onClick={onDashboard}>Open Dashboard</button>
    </section>
  )
}
