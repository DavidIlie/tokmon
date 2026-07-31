import React from 'react'
import {
  accountProviderOrdinals,
  adjustMenuBarSpacing,
  projectAccountIdentity,
  patchMenuBarPresentation,
  resetMenuBarPresentation,
  setMenuBarElementVisibility,
  setMenuBarValue,
  MENU_BAR_SPACING_MAX_PT,
  PROVIDER_META,
  PROVIDER_ORDER,
  DESKTOP_GRAPH_RANGES,
  getTrackedAccountRows,
  providerDetectionEnabled,
  removedRowCopy,
  setDetectedAccountExcluded,
  setProviderDetectionEnabled,
  setProviderTrackingEnabled,
  type Config,
  type MenuBarDensity,
  type MenuBarElement,
  type MenuBarSpacingField,
  type WebAccount,
  type WebSnapshot,
} from '../../web/contract'
import type { DesktopState, DesktopUpdateState } from '../shared/desktop-contract'
import { daemonLabel } from '../shared/presentation'
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
type MenuBarPreviewStyle = React.CSSProperties & Record<'--menubar-native-inset', string>

const MACOS_STATUS_ITEM_INLINE_INSET_PT = 10

function themePreviewStyle(appearance: AppearanceConfig, preset: ThemePreset, systemMode: 'light' | 'dark'): PreviewStyle {
  const tokens = resolveTheme({ ...appearance, preset }, systemMode).tokens
  return {
    '--preview-bg': tokens.panel,
    '--preview-accent': tokens.accent,
    '--preview-cost': tokens.cost,
    '--preview-dim': tokens.textDim,
  }
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

export function SettingsHub({ config, onBack, onTheme, onMenuBar, onProviders, onDesktop, onQuit }: {
  config: Config
  onBack(): void
  onTheme(): void
  onMenuBar(): void
  onProviders(): void
  onDesktop(): void
  onQuit(): void
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
          <span><b>Providers &amp; Accounts</b><small>{config.accountDetection.enabled ? 'Automatic discovery on' : 'Manual accounts only'} · {config.accountDetection.excludedAccounts.length} removed</small></span>
          <span className="destination-chevron" aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-destination" onClick={onDesktop}>
          <span className="desktop-glyph" aria-hidden="true"><i /></span>
          <span><b>Desktop App</b><small>Privacy, cards, startup, and updates</small></span>
          <span className="destination-chevron" aria-hidden="true">›</span>
        </button>
      </nav>
      {/* Quit is an app command, not a preference: menu-bar apps keep it one click from
          the menu, so it sits in the hub's footer rather than inside a settings page. */}
      <button type="button" className="settings-quit" onClick={onQuit}>Quit Tokmon</button>
    </section>
  )
}

const MODES: ReadonlyArray<{ value: AppearanceConfig['mode']; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/**
 * Select a theme preset. Deliberately seeds no `custom` block: repairAppearance
 * materializes one with base 'tokmon', which is what this sheet's preview resolves
 * through and what the dashboard editor writes. Seeding a base from the outgoing
 * preset made the Custom tile paint one palette and then commit another.
 */
export function applyThemePreset(config: Config, preset: ThemePreset): Config {
  return {
    ...config,
    appearance: {
      ...config.appearance,
      preset,
      ...(isDarkOnlyThemePreset(preset) ? { mode: 'dark' as const } : {}),
    },
  }
}

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
  const selectPreset = (preset: ThemePreset) => onPatch(next => applyThemePreset(next, preset))
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

function MenuBarStepper({ label, field, value, onAdjust }: {
  label: string
  field: MenuBarSpacingField
  value: number
  onAdjust(field: MenuBarSpacingField, direction: -1 | 1): void
}) {
  return (
    <div className="menubar-stepper">
      <span>{label}</span>
      <span className="stepper-control">
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= 0} onClick={() => onAdjust(field, -1)}>−</button>
        <output aria-label={`${label} value`}>{value.toFixed(1)} pt</output>
        <button type="button" aria-label={`Increase ${label}`} disabled={value >= MENU_BAR_SPACING_MAX_PT[field]} onClick={() => onAdjust(field, 1)}>+</button>
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
  const setElement = (key: MenuBarElement, value: boolean) => {
    if (!value && menuBar.elements[key] && enabledElements === 1) {
      onToast('Keep at least one menu bar element visible.')
      return
    }
    onPatch(next => setMenuBarElementVisibility(next, key, value))
  }
  const adjustSpacing = (field: MenuBarSpacingField, direction: -1 | 1) => onPatch(next => (
    adjustMenuBarSpacing(next, field, direction)
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
  const nativeInsetPt = platform === 'darwin' ? MACOS_STATUS_ITEM_INLINE_INSET_PT : 0
  const nativePreviewStyle: MenuBarPreviewStyle = { '--menubar-native-inset': `${nativeInsetPt}px` }
  const previewWidthCopy = previewWidth === null
    ? '—'
    : platform === 'darwin'
      ? `${previewWidth.toFixed(1)} pt content · ${(previewWidth + nativeInsetPt * 2).toFixed(1)} pt item`
      : `${previewWidth.toFixed(1)} pt content`
  return (
    <section className="settings-view menubar-settings" aria-label="Menu bar settings">
      <SettingsHeader title="Menu Bar" backLabel="Settings" onBack={onBack} />
      <div className="menubar-preview-stage" aria-label="Live menu bar preview">
        <div className="menubar-preview-band">
          <span className="menubar-preview-native" data-native={platform === 'darwin' || undefined} style={nativePreviewStyle}>
            <span ref={previewStrip} className="menubar-preview-bracket" data-empty={pins.length === 0 || undefined}>
              {pins.length === 0
                ? <span className="menubar-preview-empty"><i aria-hidden="true" />Pin a provider from Usage</span>
                : <MenuBarStripPreview
                    values={values} menuBar={menuBar} displayWidthPt={displayWidthPt}
                    className="menubar-live-preview"
                    ariaLabel={`Tokmon menu bar preview with ${pins.length} pinned provider${pins.length === 1 ? '' : 's'}`}
                    onPlan={setPreviewPlan}
                  />}
            </span>
          </span>
          <span className="menubar-preview-system" aria-hidden="true"><i /><i /><i /></span>
        </div>
        <span className="menubar-preview-width">{previewWidthCopy}</span>
      </div>
      <p className="menubar-preview-caption">Highlighted pill includes macOS’s 10 pt inset on each side. Brackets mark Tokmon content.</p>
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
            <MenuBarStepper label="Edge" field="edgePaddingPt" value={menuBar.customSpacing.edgePaddingPt} onAdjust={adjustSpacing} />
            <MenuBarStepper label="Mark to value" field="markValueGapPt" value={menuBar.customSpacing.markValueGapPt} onAdjust={adjustSpacing} />
            <MenuBarStepper label="Between providers" field="providerGapPt" value={menuBar.customSpacing.providerGapPt} onAdjust={adjustSpacing} />
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

function launchAtLoginHint(loginItem: DesktopState['loginItem'], requested: boolean): string {
  if (loginItem.status === 'development') return 'Available in the installed app'
  if (loginItem.status === 'unsupported') return 'Available on macOS and Windows'
  if (loginItem.status === 'requires-approval') return 'Allow Tokmon in System Settings → General → Login Items'
  if (loginItem.status === 'not-found') return 'Reinstall Tokmon, then try again'
  if (loginItem.status === 'error') return loginItem.error ?? 'Couldn’t update the system login item'
  if (requested && !loginItem.enabled) return 'Disabled in system startup settings'
  return loginItem.enabled ? 'Starts silently after sign-in' : 'Start Tokmon silently after sign-in'
}

export function DesktopSettings({ config, update, loginItem, appVersion, daemon, onPatch, onBack, onDashboard, onCheckUpdates }: {
  config: Config
  update: DesktopUpdateState
  loginItem: DesktopState['loginItem']
  appVersion: string
  daemon: DesktopState['daemon']
  onPatch(mutate: (config: Config) => Config): void
  onBack(): void
  onDashboard(): void
  onCheckUpdates(): void
}) {
  const service = daemonLabel(daemon)
  const loginItemUnavailable = loginItem.status === 'development' || loginItem.status === 'unsupported'
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
        <SettingsRow label="Launch at login" hint={launchAtLoginHint(loginItem, config.tray.launchAtLogin)}>
          <Toggle
            value={config.tray.launchAtLogin}
            label="Launch at login"
            disabled={loginItemUnavailable}
            onChange={value => onPatch(next => ({ ...next, tray: { ...next.tray, launchAtLogin: value } }))}
          />
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
  const rows = getTrackedAccountRows(config, [], snapshot.accounts, snapshot.suppressedAccounts)
  const liveBySource = new Map(snapshot.accounts.map(account => [
    `${account.providerId}:${account.homeDir ?? '~'}`,
    account,
  ]))
  const ordinals = accountProviderOrdinals(snapshot.accounts)
  const rowIdentity = (row: typeof rows[number]): string => {
    const live = snapshot.accounts.find(account => account.id === row.id)
      ?? liveBySource.get(`${row.providerId}:${row.homeDir}`)
    return projectAccountIdentity({
      identity: live?.identity,
      visible: live?.identity?.accessibleLabel ?? row.name,
      providerName: PROVIDER_META[row.providerId].name,
      // Removed rows resolve to no account and must not borrow a live ordinal.
      ordinal: (live && ordinals.get(live.id)) ?? null,
      privacyMode: config.privacyMode,
    })
  }
  const rowStatus = (row: typeof rows[number], live: WebAccount | undefined): string => {
    if (row.source === 'ignored') return removedRowCopy(row.live).status
    if (row.source === 'configured') return row.enabled ? 'Manual · tracking' : 'Manual · disabled'
    if (live?.billing?.error) return `Detected · ${live.billing.error}`
    if (live?.dashboard || live?.table) return 'Detected · usage found'
    return 'Detected · no usage or quota data'
  }
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
              const installed = snapshot.installedProviders?.includes(providerId) ?? false
              return <div key={providerId}>
                <span>{name}{installed ? ' · installed' : ''}</span>
                <Toggle
                  value={enabled} label={`Track ${name}`}
                  onChange={value => onPatch(next => setProviderTrackingEnabled(next, providerId, value))}
                />
              </div>
            })}
          </div>
        </div>
        <div className="settings-subsection-heading">
          <b>Accounts on this computer</b>
          <small>Remove one detected account without changing its provider files, login, or the other accounts.</small>
        </div>
        <div className="detection-accounts" aria-label="Accounts on this computer">
          {rows.length === 0 && <p className="settings-empty">No accounts found. Leave automatic discovery on or add one manually.</p>}
          {rows.map(row => {
            const live = snapshot.accounts.find(account => account.id === row.id)
              ?? liveBySource.get(`${row.providerId}:${row.homeDir}`)
            const ignored = row.source === 'ignored'
            return (
              <div key={`${row.source}:${row.id}`} data-ignored={ignored || undefined}>
                <span>
                  <b>{rowIdentity(row)}</b>
                  <small>{rowStatus(row, live)}{config.privacyMode ? ' · Path hidden' : ` · ${row.homeDir}`}</small>
                </span>
                {row.source === 'auto' ? (
                  <button type="button" aria-label={`Remove ${rowIdentity(row)} from Tokmon`} onClick={() => onPatch(next => ({
                    ...next,
                    activeAccountId: next.activeAccountId === row.id ? null : next.activeAccountId,
                    accountDetection: setDetectedAccountExcluded(next.accountDetection, {
                      providerId: row.providerId,
                      homeDir: row.homeDir,
                    }, true),
                  }))}>Remove</button>
                ) : ignored ? (
                  <button type="button" aria-label={`${removedRowCopy(row.live).action} ${rowIdentity(row)}`} onClick={() => onPatch(next => ({
                    ...next,
                    accountDetection: setDetectedAccountExcluded(next.accountDetection, row.excludedRef!, false),
                  }))}>{removedRowCopy(row.live).action}</button>
                ) : (
                  <button type="button" onClick={() => onPatch(next => ({
                    ...next,
                    activeAccountId: !row.enabled || next.activeAccountId !== row.id ? next.activeAccountId : null,
                    accounts: next.accounts.map(account =>
                      account.id === row.id ? { ...account, enabled: !row.enabled } : account),
                  }))}>{row.enabled ? 'Disable' : 'Enable'}</button>
                )}
              </div>
            )
          })}
        </div>
        <div className="settings-subsection-heading">
          <b>Automatic discovery</b>
          <small>Advanced scan policy. Use Remove above when you only want to stop tracking one account.</small>
        </div>
        <SettingsRow label="Discover accounts" hint="Turning this off hides every detected account; manual accounts remain">
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
      </div>
      <button type="button" className="manage-settings" onClick={onDashboard}>Open full account editor…</button>
    </section>
  )
}
