import React from 'react'
import {
  PROVIDER_META,
  PROVIDER_ORDER,
  DESKTOP_GRAPH_RANGES,
  MAX_PINNED_PROVIDERS,
  providerDetectionEnabled,
  setDetectedAccountExcluded,
  setProviderDetectionEnabled,
  toggleProviderSelection,
  type Config,
  type WebSnapshot,
} from '../../web/contract'
import type { DesktopState, DesktopUpdateState } from '../shared/desktop-contract'
import type { ProviderGroup } from './presentation'
import {
  isBuiltInThemePreset,
  isDarkOnlyThemePreset,
  resolveTheme,
  THEME_PRESET_OPTIONS,
  themePresetOption,
  type AppearanceConfig,
  type ThemePreset,
} from '../../theme'

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

export function UpdateReady({ update, currentVersion, onInstall }: {
  update: DesktopUpdateState; currentVersion: string; onInstall(): void
}) {
  if (update.status !== 'downloaded' || !update.availableVersion) return null
  return (
    <aside className="update-ready" role="status" aria-label={`Tokmon ${update.availableVersion} is ready to install`}>
      <span className="update-copy">
        <strong>Tokmon {update.availableVersion} is ready</strong>
        <small>Current version {currentVersion}</small>
      </span>
      <button type="button" onClick={onInstall}>Restart to Install</button>
    </aside>
  )
}

function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="settings-row"><span><b>{label}</b>{hint && <small>{hint}</small>}</span><span className="settings-control">{children}</span></div>
}

function Toggle({ value, onChange, label }: { value: boolean; onChange(value: boolean): void; label: string }) {
  return <button type="button" className="toggle" data-on={value} role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}><span /></button>
}

function SettingsHeader({ title, backLabel, onBack }: { title: string; backLabel: string; onBack(): void }) {
  return (
    <header className="settings-header">
      <button type="button" className="settings-back" aria-label={`Back to ${backLabel}`} onClick={onBack}>‹ {backLabel}</button>
      <strong>{title}</strong>
    </header>
  )
}

export function SettingsHub({ config, onBack, onTheme, onDesktop, onDetection }: {
  config: Config
  onBack(): void
  onTheme(): void
  onDesktop(): void
  onDetection(): void
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
        <button type="button" className="settings-destination" onClick={onDesktop}>
          <span className="desktop-glyph" aria-hidden="true"><i /></span>
          <span><b>Desktop App</b><small>Menu bar, privacy, startup</small></span>
          <span className="destination-chevron" aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-destination" onClick={onDetection}>
          <span className="detection-glyph" aria-hidden="true"><i /><i /></span>
          <span><b>Accounts & Detection</b><small>{config.accountDetection.enabled ? 'Automatic discovery on' : 'Manual accounts only'} · {config.accountDetection.excludedAccounts.length} ignored</small></span>
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
          <span className="segmented theme-mode" aria-label="Appearance mode">
            {MODES.map(option => {
              const unavailable = darkOnly && option.value !== 'dark'
              return <button
                key={option.value} type="button" data-active={shownMode === option.value}
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

function updateStatusCopy(update: DesktopUpdateState): string {
  if (update.status === 'disabled') return 'Automatic updates are available in the installed app'
  if (update.status === 'unsupported') return 'Updates for this Linux package are managed by your package manager'
  if (update.status === 'checking') return 'Looking for a newer version…'
  if (update.status === 'available' || update.status === 'downloading') {
    const progress = update.progressPercent === null ? '' : ` · ${Math.round(update.progressPercent)}%`
    return `Downloading${update.availableVersion ? ` ${update.availableVersion}` : ''}${progress}`
  }
  if (update.status === 'downloaded') return `${update.availableVersion ?? 'An update'} is ready to install`
  if (update.status === 'error') return 'The last update check failed · Try again'
  return 'Checks automatically after launch and every hour'
}

export function DesktopSettings({ config, groups, update, appVersion, daemon, onPatch, onBack, onDashboard, onCheckUpdates, onQuit }: {
  config: Config
  groups: ProviderGroup[]
  update: DesktopUpdateState
  appVersion: string
  daemon: DesktopState['daemon']
  onPatch(mutate: (config: Config) => Config): void
  onBack(): void
  onDashboard(): void
  onCheckUpdates(): void
  onQuit(): void
}) {
  const pins = config.tray.pinnedProviders
  const expandedProviders = config.desktop?.expandedProviders ?? []
  const knownProviders = new Set(groups.map(group => group.providerId))
  const service = daemonLabel(daemon)
  const updateBusy = update.status === 'checking' || update.status === 'available' || update.status === 'downloading'
  const updateDisabled = update.status === 'disabled' || update.status === 'unsupported' || updateBusy || update.status === 'downloaded'
  const updateLabel = update.status === 'downloaded'
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
          <span className="segmented">
            <button type="button" data-active={config.tray.displayMetric === 'smartHeadroom'} onClick={() => onPatch(next => ({ ...next, tray: { ...next.tray, displayMetric: 'smartHeadroom' } }))}>Smart</button>
            <button type="button" data-active={config.tray.displayMetric === 'tightestRemaining'} onClick={() => onPatch(next => ({ ...next, tray: { ...next.tray, displayMetric: 'tightestRemaining' } }))}>Highest usage</button>
          </span>
        </SettingsRow>
        <SettingsRow label="Menu bar text" hint="Show score beside provider mark">
          <Toggle value={config.tray.showMenuBarText} label="Menu bar text" onChange={value => onPatch(next => ({ ...next, tray: { ...next.tray, showMenuBarText: value } }))} />
        </SettingsRow>
        <SettingsRow label="Menu bar value" hint="Usage percentage or today's local tokens">
          <span className="segmented">
            <button type="button" data-active={config.tray.menuBarValue === 'usage'} onClick={() => onPatch(next => ({ ...next, tray: { ...next.tray, menuBarValue: 'usage' } }))}>Usage</button>
            <button type="button" data-active={config.tray.menuBarValue === 'todayTokens'} onClick={() => onPatch(next => ({ ...next, tray: { ...next.tray, menuBarValue: 'todayTokens' } }))}>Tokens today</button>
          </span>
        </SettingsRow>
        <SettingsRow label="Pinned providers" hint="Choose up to two · order preserved">
          <span className="provider-chips">{groups.map(group => <button key={group.providerId} type="button" data-active={pins.includes(group.providerId)} onClick={() => onPatch(next => ({ ...next, tray: { ...next.tray, pinnedProviders: toggleProviderSelection(next.tray.pinnedProviders, group.providerId, knownProviders, MAX_PINNED_PROVIDERS) } }))}>{group.name}</button>)}</span>
        </SettingsRow>
        <SettingsRow label="Expanded by default" hint="Synced through the daemon">
          <span className="provider-chips">{groups.map(group => <button key={group.providerId} type="button" data-active={expandedProviders.includes(group.providerId)} onClick={() => onPatch(next => ({ ...next, desktop: { ...next.desktop, expandedProviders: toggleProviderSelection(next.desktop.expandedProviders, group.providerId, knownProviders) } }))}>{group.name}</button>)}</span>
        </SettingsRow>
        <SettingsRow label="Graph range" hint="Trailing spend activity">
          <span className="segmented">
            {DESKTOP_GRAPH_RANGES.map(value => <button
              key={value} type="button" data-active={config.desktop.graphRangeDays === value}
              onClick={() => onPatch(next => ({ ...next, desktop: { ...next.desktop, graphRangeDays: value } }))}
            >{value}d</button>)}
          </span>
        </SettingsRow>
        <SettingsRow label="Active window" hint="Recent usage emphasis">
          <span className="segmented">{[5, 10, 20, 30].map(value => <button key={value} type="button" data-active={config.tray.activeTimeoutMin === value} onClick={() => onPatch(next => ({ ...next, tray: { ...next.tray, activeTimeoutMin: value } }))}>{value}m</button>)}</span>
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

export function DetectionSettings({ config, snapshot, onPatch, onBack, onDashboard }: {
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
    <section className="settings-view" aria-label="Account detection settings">
      <SettingsHeader title="Accounts & Detection" backLabel="Settings" onBack={onBack} />
      <div className="settings-list">
        <SettingsRow label="Discover accounts" hint="Manual accounts keep working when this is off">
          <Toggle
            value={config.accountDetection.enabled}
            label="Discover accounts"
            onChange={enabled => onPatch(next => ({ ...next, accountDetection: { ...next.accountDetection, enabled } }))}
          />
        </SettingsRow>
        <SettingsRow label="Provider detectors" hint="Choose where Tokmon searches automatically">
          <span className="provider-chips">
            {PROVIDER_ORDER.map(providerId => {
              const enabled = providerDetectionEnabled(config.accountDetection, providerId)
              return <button
                key={providerId} type="button" data-active={enabled}
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
