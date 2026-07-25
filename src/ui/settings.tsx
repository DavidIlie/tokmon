import { Fragment, memo, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { glyphs } from '../glyphs'
import { configLocation, DEFAULT_MENU_BAR_CONFIG, DESKTOP_GRAPH_RANGES, generateAccountId, COLOR_PALETTE, providerDetectionEnabled, redactEmail, sanitizeTyped, toggleProviderSelection, type Config, type Account, type MenuBarConfig, type TrackedAccountRow } from '../config'
import { PROVIDER_ORDER, PROVIDERS } from '../providers'
import type { ProviderId } from '../providers/types'
import { systemTimezone } from '../tz'
import { CaretText, truncateName } from './shared'
import { useTuiTheme } from './theme'
import { themePresetOption, isDarkOnlyThemePreset, THEME_PRESET_IDS } from '../theme'
import type { InputKey, KeyContext } from './keybinding-context'

type TuiTheme = ReturnType<typeof useTuiTheme>

/** Render context for a settings row's value cell (and its optional below-line). */
export interface RowRenderCtx {
  config: Config
  theme: TuiTheme
  tzEdit: string | null
  tzCaret: number
  tzError: string | null
  tzDisplay: string
  allowedHostsEdit: string | null
  allowedHostsCaret: number
  allowedHostsError: string | null
}

/**
 * One settings row, co-locating everything that must stay index-aligned: the
 * value-cell `render`, an optional `below` line (errors/warnings), and the
 * key-dispatch `onAdjust`. A row's index is its position in the tab array, so
 * render, dispatch, and row count all derive from these arrays — inserting or
 * reordering a row is a single edit instead of the old positional
 * idx/switch/constant triple-coupling.
 */
export interface SettingRow {
  key: string
  label: string
  render: (rc: RowRenderCtx) => ReactNode
  below?: (rc: RowRenderCtx, focused: boolean) => ReactNode
  onAdjust: (input: string, key: InputKey, ctx: KeyContext) => void
}

const caret = (value: ReactNode): ReactNode => (
  <><Text dimColor>{glyphs().caretL} </Text>{value}<Text dimColor> {glyphs().caretR}</Text></>
)

const toggleText = (on: boolean, theme: TuiTheme, onLabel: string, offLabel: string, offColor?: string): ReactNode => (
  <Text bold color={on ? theme.ok : offColor ?? theme.crit}>{on ? onLabel : offLabel}</Text>
)

function cycleNumber(values: readonly number[], current: number, direction: -1 | 1): number {
  const exact = values.indexOf(current)
  const index = exact >= 0
    ? exact
    : values.reduce((best, value, candidate) => (
      Math.abs(value - current) < Math.abs(values[best]! - current) ? candidate : best
    ), 0)
  return values[(index + direction + values.length) % values.length]!
}

const step = (key: InputKey): -1 | 1 => (key.leftArrow ? -1 : 1)
const isToggleKey = (key: InputKey): boolean => key.leftArrow || key.rightArrow || key.return
const isAdjustKey = (input: string, key: InputKey): boolean => input === ' ' || key.leftArrow || key.rightArrow || key.return

type MenuBarElement = keyof MenuBarConfig['elements']

function toggleMenuBarPresentationElement(config: Config, element: MenuBarElement): Config {
  const elements = config.tray.menuBar.elements
  if (elements[element] && Object.values(elements).filter(Boolean).length === 1) return config
  const nextElements = { ...elements, [element]: !elements[element] }
  return {
    ...config,
    tray: {
      ...config.tray,
      showMenuBarText: nextElements.value,
      menuBar: { ...config.tray.menuBar, elements: nextElements },
    },
  }
}

function adjustMenuBarSpacing(
  config: Config,
  field: keyof MenuBarConfig['customSpacing'],
  direction: -1 | 1,
  max: number,
): Config {
  const current = config.tray.menuBar.customSpacing[field]
  const value = Math.min(max, Math.max(0, Math.round((current + direction * 0.5) * 2) / 2))
  return {
    ...config,
    tray: {
      ...config.tray,
      menuBar: {
        ...config.tray.menuBar,
        mode: 'custom',
        customSpacing: { ...config.tray.menuBar.customSpacing, [field]: value },
      },
    },
  }
}

export const GENERAL_SETTINGS: SettingRow[] = [
  {
    key: 'refreshInterval', label: 'Refresh interval',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.interval}s</Text>),
    onAdjust: (_input, key, ctx) => {
      if (key.leftArrow) ctx.global.updateConfig(c => ({ ...c, interval: Math.max(1, c.interval - 1) }))
      if (key.rightArrow) ctx.global.updateConfig(c => ({ ...c, interval: c.interval + 1 }))
    },
  },
  {
    key: 'billingPoll', label: 'Billing poll',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.billingInterval}m</Text>),
    onAdjust: (_input, key, ctx) => {
      if (key.leftArrow) ctx.global.updateConfig(c => ({ ...c, billingInterval: Math.max(1, c.billingInterval - 1) }))
      if (key.rightArrow) ctx.global.updateConfig(c => ({ ...c, billingInterval: c.billingInterval + 1 }))
    },
  },
  {
    key: 'clearScreen', label: 'Clear screen',
    render: rc => toggleText(rc.config.clearScreen, rc.theme, 'on', 'off'),
    onAdjust: (_input, key, ctx) => { if (isToggleKey(key)) ctx.global.updateConfig(c => ({ ...c, clearScreen: !c.clearScreen })) },
  },
  {
    key: 'privacyMode', label: 'Privacy mode',
    render: rc => toggleText(rc.config.privacyMode, rc.theme, 'on', 'off'),
    onAdjust: (_input, key, ctx) => { if (isToggleKey(key)) ctx.global.updateConfig(c => ({ ...c, privacyMode: !c.privacyMode })) },
  },
  {
    key: 'privacyKey', label: 'Privacy key',
    render: rc => <Text bold color={rc.theme.cost}>{rc.config.privacyToggleKey === ' ' ? 'space' : rc.config.privacyToggleKey}</Text>,
    onAdjust: (input, key, ctx) => {
      if (ctx.textInput.isPrintable(input, key)) {
        const clean = sanitizeTyped(input)
        if (clean.length === 1) ctx.global.updateConfig(c => ({ ...c, privacyToggleKey: clean }))
      }
      if (key.backspace || key.delete) ctx.global.updateConfig(c => ({ ...c, privacyToggleKey: 'p' }))
    },
  },
  {
    key: 'timezone', label: 'Timezone',
    render: rc => rc.tzEdit !== null
      ? <><Text dimColor>[</Text><CaretText value={rc.tzEdit ?? ''} caret={rc.tzCaret} color={rc.theme.accent} /><Text dimColor>]</Text></>
      : <Text bold color={rc.theme.cost}>{rc.tzDisplay}</Text>,
    below: (rc, focused) => (focused && rc.tzError ? <Text color={rc.theme.crit}>  {rc.tzError}</Text> : null),
    onAdjust: (_input, key, ctx) => {
      if (key.return) {
        const initial = ctx.global.config.timezone ?? ''
        ctx.timezoneEditor.setValue(initial)
        ctx.timezoneEditor.setCaret(initial.length)
        ctx.timezoneEditor.setError(null)
      }
      if (key.leftArrow || key.rightArrow) {
        ctx.global.updateConfig(c => ({ ...c, timezone: c.timezone === null ? systemTimezone() : null }))
      }
    },
  },
  {
    key: 'dashboard', label: 'Dashboard',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.dashboardLayout === 'grid' ? 'grid (all)' : 'single (cycle)'}</Text>),
    onAdjust: (_input, key, ctx) => { if (isToggleKey(key)) ctx.global.updateConfig(c => ({ ...c, dashboardLayout: c.dashboardLayout === 'grid' ? 'single' : 'grid' })) },
  },
  {
    key: 'defaultFocus', label: 'Default focus',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.defaultFocus === 'all' ? 'All' : 'Last account'}</Text>),
    onAdjust: (_input, key, ctx) => { if (isToggleKey(key)) ctx.global.updateConfig(c => ({ ...c, defaultFocus: c.defaultFocus === 'all' ? 'last' : 'all' })) },
  },
  {
    key: 'networkAccess', label: 'Network access',
    render: rc => <Text bold color={rc.config.allowNetworkAccess ? rc.theme.crit : rc.theme.ok}>{rc.config.allowNetworkAccess ? 'LAN (unsafe)' : 'local only'}</Text>,
    onAdjust: (_input, key, ctx) => { if (isToggleKey(key)) ctx.global.updateConfig(c => ({ ...c, allowNetworkAccess: !c.allowNetworkAccess })) },
  },
  {
    key: 'allowedHosts', label: 'Allowed hosts',
    render: rc => rc.allowedHostsEdit !== null
      ? <><Text dimColor>[</Text><CaretText value={rc.allowedHostsEdit ?? ''} caret={rc.allowedHostsCaret} color={rc.theme.accent} /><Text dimColor>]</Text></>
      : <Text bold color={rc.theme.cost}>{rc.config.allowedHosts.join(', ') || 'none'}</Text>,
    below: (rc, focused) => (
      <>
        {focused && rc.allowedHostsError ? <Text color={rc.theme.crit}>  {rc.allowedHostsError}</Text> : null}
        {rc.config.allowNetworkAccess ? <Text color={rc.theme.crit}>  Warning: dashboard data and settings will be exposed to your local network after daemon restart.</Text> : null}
      </>
    ),
    onAdjust: (_input, key, ctx) => {
      if (key.return) {
        const initial = ctx.global.config.allowedHosts.join(', ')
        ctx.allowedHostsEditor.setValue(initial)
        ctx.allowedHostsEditor.setCaret(initial.length)
        ctx.allowedHostsEditor.setError(null)
      }
    },
  },
  {
    key: 'resetTimes', label: 'Reset times',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.resetDisplay === 'relative' ? 'time remaining' : 'exact date/time'}</Text>),
    onAdjust: (_input, key, ctx) => { if (isToggleKey(key)) ctx.global.updateConfig(c => ({ ...c, resetDisplay: c.resetDisplay === 'relative' ? 'absolute' : 'relative' })) },
  },
]

export const THEME_SETTINGS: SettingRow[] = [
  {
    key: 'preset', label: 'Preset',
    render: rc => caret(<Text bold color={rc.theme.accent}>{themePresetLabel(rc.config.appearance.preset)}</Text>),
    onAdjust: (_input, key, ctx) => {
      if (!isToggleKey(key)) return
      const direction = step(key)
      ctx.global.updateConfig(current => {
        const choices = THEME_PRESET_IDS.filter(preset => preset !== 'custom' || current.appearance.custom)
        const currentIndex = Math.max(0, choices.findIndex(v => v === current.appearance.preset))
        const preset = choices[(currentIndex + direction + choices.length) % choices.length]!
        return { ...current, appearance: { ...current.appearance, preset, ...(isDarkOnlyThemePreset(preset) ? { mode: 'dark' as const } : {}) } }
      })
    },
  },
  {
    key: 'appAppearance', label: 'App appearance',
    render: rc => caret(<Text bold color={rc.theme.cost}>{appearanceModeLabel(rc.config.appearance.mode)}</Text>),
    onAdjust: (_input, key, ctx) => {
      if (!isToggleKey(key)) return
      const direction = step(key)
      ctx.global.updateConfig(current => {
        if (isDarkOnlyThemePreset(current.appearance.preset)) return current
        const choices = ['auto', 'light', 'dark'] as const
        const currentIndex = choices.indexOf(current.appearance.mode)
        return { ...current, appearance: { ...current.appearance, mode: choices[(currentIndex + direction + choices.length) % choices.length]! } }
      })
    },
  },
  {
    key: 'terminalColors', label: 'Terminal colors',
    render: rc => caret(<Text bold color={rc.theme.accent}>{terminalModeLabel(rc.config.appearance.terminal)}</Text>),
    onAdjust: (_input, key, ctx) => {
      if (!isToggleKey(key)) return
      const direction = step(key)
      ctx.global.updateConfig(current => {
        const choices = ['ansi', 'dark', 'light', 'off'] as const
        const currentIndex = choices.indexOf(current.appearance.terminal)
        return { ...current, appearance: { ...current.appearance, terminal: choices[(currentIndex + direction + choices.length) % choices.length]! } }
      })
    },
  },
]

export const DESKTOP_FIXED_SETTINGS: SettingRow[] = [
  {
    key: 'trayApp', label: 'Tray app',
    render: rc => toggleText(rc.config.tray.enabled, rc.theme, 'on', 'off'),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => ({ ...c, tray: { ...c.tray, enabled: !c.tray.enabled } })) },
  },
  {
    key: 'menuBarMode', label: 'Menu bar layout',
    render: rc => caret(<Text bold color={rc.theme.accent}>{rc.config.tray.menuBar.mode}</Text>),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => ({ ...c, tray: { ...c.tray, menuBar: { ...c.tray.menuBar, mode: c.tray.menuBar.mode === 'auto' ? 'custom' : 'auto' } } })) },
  },
  {
    key: 'menuBarMark', label: 'Provider mark',
    render: rc => toggleText(rc.config.tray.menuBar.elements.providerMark, rc.theme, 'shown', 'hidden', rc.theme.unknown),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => toggleMenuBarPresentationElement(c, 'providerMark')) },
  },
  {
    key: 'menuBarValue', label: 'Value',
    render: rc => toggleText(rc.config.tray.menuBar.elements.value, rc.theme, 'shown', 'hidden', rc.theme.unknown),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => toggleMenuBarPresentationElement(c, 'value')) },
  },
  {
    key: 'menuBarProgress', label: 'Progress',
    render: rc => toggleText(rc.config.tray.menuBar.elements.progress, rc.theme, 'shown', 'hidden', rc.theme.unknown),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => toggleMenuBarPresentationElement(c, 'progress')) },
  },
  {
    key: 'menuBarContent', label: 'Menu bar content',
    render: rc => caret(<Text bold color={rc.theme.accent}>{rc.config.tray.menuBarValue === 'todayTokens' ? 'tokens today' : 'usage'}</Text>),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => ({ ...c, tray: { ...c.tray, menuBarValue: c.tray.menuBarValue === 'usage' ? 'todayTokens' : 'usage' } })) },
  },
  {
    key: 'menuBarDensity', label: 'Density',
    render: rc => caret(<Text bold color={rc.theme.accent}>{rc.config.tray.menuBar.density}</Text>),
    onAdjust: (input, key, ctx) => {
      if (!isAdjustKey(input, key)) return
      const choices = ['comfortable', 'compact', 'tight'] as const
      ctx.global.updateConfig(c => {
        const current = choices.indexOf(c.tray.menuBar.density)
        return { ...c, tray: { ...c.tray, menuBar: { ...c.tray.menuBar, density: choices[(current + step(key) + choices.length) % choices.length]! } } }
      })
    },
  },
  {
    key: 'menuBarEdgePadding', label: 'Edge padding',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.tray.menuBar.customSpacing.edgePaddingPt.toFixed(1)}pt</Text>),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => adjustMenuBarSpacing(c, 'edgePaddingPt', step(key), 6)) },
  },
  {
    key: 'menuBarMarkValueGap', label: 'Mark/value gap',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.tray.menuBar.customSpacing.markValueGapPt.toFixed(1)}pt</Text>),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => adjustMenuBarSpacing(c, 'markValueGapPt', step(key), 8)) },
  },
  {
    key: 'menuBarProviderGap', label: 'Provider gap',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.tray.menuBar.customSpacing.providerGapPt.toFixed(1)}pt</Text>),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => adjustMenuBarSpacing(c, 'providerGapPt', step(key), 16)) },
  },
  {
    key: 'menuBarReset', label: 'Reset presentation',
    render: rc => <Text bold color={rc.theme.unknown}>press enter</Text>,
    onAdjust: (input, key, ctx) => {
      if (input !== ' ' && !key.return) return
      ctx.global.updateConfig(c => {
        const menuBar: MenuBarConfig = {
          ...DEFAULT_MENU_BAR_CONFIG,
          elements: { ...DEFAULT_MENU_BAR_CONFIG.elements },
          customSpacing: { ...DEFAULT_MENU_BAR_CONFIG.customSpacing },
        }
        return { ...c, tray: { ...c.tray, menuBar, showMenuBarText: menuBar.elements.value } }
      })
    },
  },
  {
    key: 'summary', label: 'Summary',
    render: rc => caret(<Text bold color={rc.theme.accent}>{rc.config.tray.displayMetric === 'smartHeadroom' ? 'smart usage' : 'tightest quota'}</Text>),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => ({ ...c, tray: { ...c.tray, displayMetric: c.tray.displayMetric === 'smartHeadroom' ? 'tightestRemaining' : 'smartHeadroom' } })) },
  },
  {
    key: 'trayRefresh', label: 'Tray refresh',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.tray.pollIntervalSec}s</Text>),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => ({ ...c, tray: { ...c.tray, pollIntervalSec: cycleNumber([15, 30, 60, 120], c.tray.pollIntervalSec, step(key)) } })) },
  },
  {
    key: 'activeWindow', label: 'Active window',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.tray.activeTimeoutMin}m</Text>),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => ({ ...c, tray: { ...c.tray, activeTimeoutMin: cycleNumber([5, 10, 15, 30], c.tray.activeTimeoutMin, step(key)) } })) },
  },
  {
    key: 'graphRange', label: 'Graph range',
    render: rc => caret(<Text bold color={rc.theme.cost}>{rc.config.desktop.graphRangeDays} days</Text>),
    onAdjust: (input, key, ctx) => {
      if (!isAdjustKey(input, key)) return
      ctx.global.updateConfig(c => ({
        ...c,
        desktop: { ...c.desktop, graphRangeDays: cycleNumber(DESKTOP_GRAPH_RANGES, c.desktop.graphRangeDays, step(key)) as Config['desktop']['graphRangeDays'] },
      }))
    },
  },
  {
    key: 'launchAtLogin', label: 'Launch at login',
    render: rc => toggleText(rc.config.tray.launchAtLogin, rc.theme, 'on', 'off', rc.theme.unknown),
    onAdjust: (input, key, ctx) => { if (isAdjustKey(input, key)) ctx.global.updateConfig(c => ({ ...c, tray: { ...c.tray, launchAtLogin: !c.tray.launchAtLogin } })) },
  },
]

export const GENERAL_ROWS = GENERAL_SETTINGS.length
export const THEME_ROWS = THEME_SETTINGS.length
export const DESKTOP_FIXED_ROWS = DESKTOP_FIXED_SETTINGS.length

export const SETTINGS_TABS = ['general', 'theme', 'desktop', 'providers', 'accounts'] as const
export type SettingsTab = typeof SETTINGS_TABS[number]
const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  theme: 'Theme',
  desktop: 'Desktop App',
  providers: 'Providers',
  accounts: 'Accounts',
}

export type FormField = 'provider' | 'name' | 'homeDir' | 'color'

export interface AccountForm {
  mode: 'add' | 'edit'
  field: FormField
  providerId: ProviderId
  name: string
  homeDir: string
  color: string
  caret: number
  editingId: string | null
  error: string | null
}

export interface AccountIdentity {
  email?: string | null
  displayName?: string | null
  plan?: string | null
}

export const FORM_FIELDS: FormField[] = ['provider', 'name', 'homeDir', 'color']

export { COLOR_PALETTE } from '../config'

export const SettingsView = memo(function SettingsView({
  config, cursor, activeTab, tzEdit, tzCaret, tzError, allowedHostsEdit, allowedHostsCaret, allowedHostsError,
  resolvedTz, accountForm, activeAccountId, trackedAccounts, accountIdentities, privacyLabels,
}: {
  config: Config
  cursor: number
  activeTab: SettingsTab
  tzEdit: string | null
  tzCaret: number
  tzError: string | null
  allowedHostsEdit: string | null
  allowedHostsCaret: number
  allowedHostsError: string | null
  resolvedTz: string
  accountForm: AccountForm | null
  activeAccountId: string | null
  trackedAccounts: TrackedAccountRow[]
  accountIdentities: Map<string, AccountIdentity>
  /** Shared strict privacy projection, empty when privacy mode is off. */
  privacyLabels?: ReadonlyMap<string, string>
}) {
  const theme = useTuiTheme()
  if (accountForm) return <AccountFormView form={accountForm} accounts={config.accounts} />

  const editingTz = tzEdit !== null
  const editingAllowedHosts = allowedHostsEdit !== null
  const tzDisplay = config.timezone === null ? `System (${resolvedTz})` : config.timezone
  const tabFocused = cursor < 0
  const rc: RowRenderCtx = {
    config, theme, tzEdit, tzCaret, tzError, tzDisplay,
    allowedHostsEdit, allowedHostsCaret, allowedHostsError,
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Settings</Text>
      <Text dimColor>{configLocation()}</Text>
      <Box height={1} />
      <SettingsTabBar active={activeTab} focused={tabFocused} />
      <Box height={1} />

      {activeTab === 'general' && (
        <>
          <Text bold dimColor>General</Text>
          {GENERAL_SETTINGS.map((row, i) => (
            <Fragment key={row.key}>
              <Row cursor={cursor} idx={i} label={row.label}>{row.render(rc)}</Row>
              {row.below?.(rc, cursor === i)}
            </Fragment>
          ))}
        </>
      )}

      {activeTab === 'theme' && (
        <>
          <Text bold dimColor>Theme</Text>
          {THEME_SETTINGS.map((row, i) => (
            <Fragment key={row.key}>
              <Row cursor={cursor} idx={i} label={row.label}>{row.render(rc)}</Row>
              {row.below?.(rc, cursor === i)}
            </Fragment>
          ))}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>  Auto follows the operating system in the web and desktop apps.</Text>
            <Text dimColor>  Terminal colors never repaint your terminal background.</Text>
            {config.appearance.preset === 'custom' && (
              <Text dimColor>  Custom colors are edited in the web dashboard and shared here.</Text>
            )}
          </Box>
        </>
      )}

      {activeTab === 'desktop' && (
        <>
          <Text bold dimColor>Desktop App</Text>
          {DESKTOP_FIXED_SETTINGS.map((row, i) => (
            <Fragment key={row.key}>
              <Row cursor={cursor} idx={i} label={row.label}>{row.render(rc)}</Row>
              {row.below?.(rc, cursor === i)}
            </Fragment>
          ))}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>  Menu-bar presentation applies to the macOS desktop app.</Text>
            <Text dimColor>  Pin providers from their cards in the desktop overview.</Text>
            <Text dimColor>  Adjusting a spacing value switches the layout to custom.</Text>
          </Box>
        </>
      )}

      {activeTab === 'providers' && (
        <>
          <Text bold dimColor>Providers</Text>
          <Box>
            <Text color={cursor === 0 ? theme.accent : undefined}>{cursor === 0 ? glyphs().caretR : ' '} </Text>
            <Box width={20}><Text bold>Discover accounts</Text></Box>
            {toggleText(config.accountDetection.enabled, theme, 'on', 'off')}
          </Box>
          {PROVIDER_ORDER.map((pid, i) => {
            const selected = cursor === i + 1
            const enabled = !config.disabledProviders.includes(pid)
            const discovery = providerDetectionEnabled(config.accountDetection, pid)
            const p = PROVIDERS[pid]
            return (
              <Box key={pid}>
                <Text color={selected ? theme.accent : undefined}>{selected ? glyphs().caretR : ' '} </Text>
                <Text color={p.color}> {glyphs().dot} </Text>
                <Box width={16}><Text bold={selected}>{p.name}</Text></Box>
                <Box width={18}><Text color={enabled ? theme.ok : undefined} dimColor={!enabled}>{enabled ? `[${glyphs().check}] tracking` : '[ ] tracking'}</Text></Box>
                <Text color={discovery ? theme.ok : undefined} dimColor={!discovery}>{discovery ? `[${glyphs().check}] auto-detect` : '[ ] auto-detect'}</Text>
              </Box>
            )
          })}
        </>
      )}

      {activeTab === 'accounts' && (
        <>
          <Text bold dimColor>Accounts</Text>
          {trackedAccounts.length === 0 && (
            <Text dimColor>  none tracked {glyphs().emDash} enable a provider or add an account</Text>
          )}
          {trackedAccounts.map((acc, i) => {
            const selected = cursor === i
            const isActive = acc.id === activeAccountId
            const provider = PROVIDERS[acc.providerId]
            const identity = accountIdentities.get(acc.id)
            const rawIdentityLabel = identity?.email || identity?.displayName || acc.name
            // redactEmail cannot hide a display name that carries no email, so
            // privacy mode reads the shared projection first.
            const identityLabel = (config.privacyMode ? privacyLabels?.get(acc.id) : undefined)
              ?? (config.privacyMode ? redactEmail(rawIdentityLabel) : rawIdentityLabel)
            const plan = identity?.plan ?? null
            const ignored = acc.source === 'ignored'
            const sourceLabel = acc.source === 'auto' ? 'auto tracking' : ignored ? 'removed' : acc.enabled ? 'configured' : 'disabled'
            return (
              <Box key={`${acc.source}:${acc.id}`}>
                <Text color={selected ? theme.accent : undefined}>{selected ? glyphs().caretR : ' '} </Text>
                <Text color={ignored ? theme.unknown : acc.color || provider.color}>{ignored ? glyphs().warn : isActive ? glyphs().dot : glyphs().radioOff} </Text>
                <Box width={28}><Text bold={!ignored && acc.enabled} dimColor={ignored || !acc.enabled}>{truncateName(identityLabel, 27)}</Text></Box>
                <Box width={9}><Text color={provider.color}>{provider.name}</Text></Box>
                <Box width={18}><Text dimColor>{plan ? truncateName(plan, 17) : ''}</Text></Box>
                <Box width={14}><Text dimColor>{sourceLabel}</Text></Box>
                <Text dimColor>{config.privacyMode ? '[path hidden]' : truncateName(acc.homeDir, 24)}</Text>
              </Box>
            )
          })}
          <Box>
            <Text color={cursor === trackedAccounts.length ? theme.accent : undefined}>
              {cursor === trackedAccounts.length ? glyphs().caretR : ' '}{' '}
            </Text>
            <Text color={theme.accent}>+ </Text>
            <Text>Add account</Text>
          </Box>
        </>
      )}

      <Box height={1} />
      {tabFocused ? (
        <Text dimColor>{glyphs().arrowL}{glyphs().arrowR}/tab switch section  {glyphs().middot}  {glyphs().arrowD} rows  {glyphs().middot}  s/Esc close</Text>
      ) : editingTz ? (
        <Text dimColor>type IANA name (e.g. Europe/London) {glyphs().middot} empty = System {glyphs().middot} Enter save {glyphs().middot} Esc cancel</Text>
      ) : editingAllowedHosts ? (
        <Text dimColor>comma-separated exact DNS names {glyphs().middot} Enter save {glyphs().middot} Esc cancel</Text>
      ) : activeTab === 'theme' ? (
        <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  {glyphs().arrowL}{glyphs().arrowR} adjust  {glyphs().middot}  s/Esc close</Text>
      ) : activeTab === 'desktop' ? (
        <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  {glyphs().arrowL}{glyphs().arrowR}/space adjust  {glyphs().middot}  pins are capped at 2  {glyphs().middot}  s/Esc close</Text>
      ) : activeTab === 'providers' ? (
        <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  space tracking/global discovery  {glyphs().middot}  a per-provider auto-detect  {glyphs().middot}  s/Esc close</Text>
      ) : activeTab === 'accounts' && cursor >= 0 && cursor < trackedAccounts.length ? (
        trackedAccounts[cursor]?.source === 'auto' ? (
          <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  Enter configure  {glyphs().middot}  space activate  {glyphs().middot}  x remove  {glyphs().middot}  s/Esc close</Text>
        ) : trackedAccounts[cursor]?.source === 'ignored' ? (
          <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  Enter/x restore  {glyphs().middot}  s/Esc close</Text>
        ) : (
          <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  {glyphs().shift}{glyphs().arrowU}{glyphs().arrowD} reorder  {glyphs().middot}  Enter edit  {glyphs().middot}  e enable/disable  {glyphs().middot}  d delete  {glyphs().middot}  s/Esc close</Text>
        )
      ) : activeTab === 'accounts' && cursor === trackedAccounts.length ? (
        <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().middot}  Enter add account  {glyphs().middot}  s/Esc close</Text>
      ) : (
        <Text dimColor>{glyphs().arrowU}{glyphs().arrowD} select  {glyphs().arrowL}{glyphs().arrowR} adjust  Enter edit  tab switch section  s/Esc close</Text>
      )}
    </Box>
  )
})

function themePresetLabel(preset: Config['appearance']['preset']): string {
  return themePresetOption(preset).name
}

function appearanceModeLabel(mode: Config['appearance']['mode']): string {
  return mode === 'auto' ? 'Auto (system)' : mode === 'light' ? 'Light' : 'Dark'
}

function terminalModeLabel(mode: Config['appearance']['terminal']): string {
  return mode === 'ansi' ? 'Terminal managed' : mode === 'off' ? 'No color' : mode === 'light' ? 'Light terminal' : 'Dark terminal'
}

function SettingsTabBar({ active, focused }: { active: SettingsTab; focused: boolean }) {
  const theme = useTuiTheme()
  return (
    <Box>
      <Text color={focused ? theme.accent : undefined}>{focused ? glyphs().caretR : ' '} </Text>
      {SETTINGS_TABS.map((tab, i) => {
        const selected = tab === active
        return (
          <Box key={tab} marginRight={1}>
            {selected
              ? <Text bold inverse> {SETTINGS_TAB_LABELS[tab]} </Text>
              : <Text dimColor> {SETTINGS_TAB_LABELS[tab]} </Text>}
            {i < SETTINGS_TABS.length - 1 && <Text dimColor> </Text>}
          </Box>
        )
      })}
    </Box>
  )
}


function Row({ cursor, idx, label, children }: { cursor: number; idx: number; label: string; children: React.ReactNode }) {
  const theme = useTuiTheme()
  return (
    <Box>
      <Text color={cursor === idx ? theme.accent : undefined}>{cursor === idx ? glyphs().caretR : ' '} </Text>
      <Box width={20}><Text>{label}</Text></Box>
      {children}
    </Box>
  )
}

function AccountFormView({ form, accounts }: { form: AccountForm; accounts: Account[] }) {
  const theme = useTuiTheme()
  const previewId = form.mode === 'add'
    ? generateAccountId(form.name || 'account', accounts)
    : form.editingId ?? ''
  const accent = form.color
  const stepIndex: Record<FormField, number> = { provider: 1, name: 2, homeDir: 3, color: 4 }
  const step = stepIndex[form.field]

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={accent} bold>{glyphs().vbar}</Text>
        <Text bold>{' '}{form.mode === 'add' ? 'NEW ACCOUNT' : 'EDIT ACCOUNT'}</Text>
        <Text dimColor>   step {step} of 4</Text>
      </Box>
      <Box marginTop={1}><Stepper active={form.field} accent={accent} /></Box>

      <Box marginTop={1} flexDirection="column" borderStyle={glyphs().border} borderColor={accent} paddingX={2} paddingY={1}>
        <ProviderField value={form.providerId} focused={form.field === 'provider'} />
        <Box height={1} />
        <FormField label="Name" hint="display name for this account" value={form.name}
          focused={form.field === 'name'} caret={form.caret} accent={accent} placeholder="e.g. Work, Personal" />
        <Box height={1} />
        <FormField label="Home directory" hint={`path containing the tool's data dir  ${glyphs().middot}  ~ for default`} value={form.homeDir}
          focused={form.field === 'homeDir'} caret={form.caret} accent={accent} placeholder="~/work" mono />
        <Box height={1} />
        <ColorField value={form.color} focused={form.field === 'color'} />
        <Box height={1} />
        <Box>
          <Text dimColor>id  {glyphs().boxMark} </Text>
          <Text bold color={accent}>{previewId || 'account'}</Text>
          <Text dimColor> {glyphs().boxMark}   auto-generated from name</Text>
        </Box>
      </Box>

      {form.error && <Box marginTop={1}><Text color={theme.crit}>{glyphs().warn} {form.error}</Text></Box>}

      <Box marginTop={1}>
        <Text dimColor>tab/{glyphs().arrowU}{glyphs().arrowD} </Text><Text>switch field</Text><Text dimColor>  {glyphs().middot}  </Text>
        <Text dimColor>enter </Text><Text>{form.field === 'color' ? 'save' : 'next'}</Text><Text dimColor>  {glyphs().middot}  </Text>
        {(form.field === 'color' || form.field === 'provider') ? (
          <><Text dimColor>{glyphs().arrowL}{glyphs().arrowR} </Text><Text>{form.field === 'provider' ? 'pick provider' : 'pick color'}</Text><Text dimColor>  {glyphs().middot}  </Text></>
        ) : (
          <><Text dimColor>{glyphs().arrowL}{glyphs().arrowR} </Text><Text>move caret</Text><Text dimColor>  {glyphs().middot}  </Text></>
        )}
        <Text dimColor>ctrl+s </Text><Text>save</Text><Text dimColor>  {glyphs().middot}  </Text>
        <Text dimColor>esc </Text><Text>cancel</Text>
      </Box>
    </Box>
  )
}

function Stepper({ active, accent }: { active: FormField; accent: string }) {
  const steps: { id: FormField; label: string }[] = [
    { id: 'provider', label: 'Provider' },
    { id: 'name', label: 'Name' },
    { id: 'homeDir', label: 'Home' },
    { id: 'color', label: 'Color' },
  ]
  const activeIdx = steps.findIndex(s => s.id === active)
  return (
    <Box>
      {steps.map((s, i) => {
        const done = i < activeIdx
        const cur = i === activeIdx
        const dot = done ? glyphs().dot : cur ? glyphs().dotSel : glyphs().radioOff
        return (
          <Box key={s.id}>
            <Text color={cur || done ? accent : undefined} dimColor={!cur && !done}>{dot} </Text>
            <Text bold={cur} color={cur ? accent : undefined} dimColor={!cur}>{s.label}</Text>
            {i < steps.length - 1 && <Text dimColor>  {glyphs().rule}  </Text>}
          </Box>
        )
      })}
    </Box>
  )
}

function ProviderField({ value, focused }: { value: ProviderId; focused: boolean }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? PROVIDERS[value].color : undefined} bold={focused} dimColor={!focused}>
          {focused ? glyphs().caretR : ' '} Provider
        </Text>
      </Box>
      <Box>
        <Text>  {focused ? glyphs().vbar : ' '} </Text>
        {PROVIDER_ORDER.map(pid => {
          const selected = pid === value
          const p = PROVIDERS[pid]
          return (
            <Box key={pid} marginRight={2}>
              {selected
                ? <Text bold color={p.color}>[{p.name}]</Text>
                : <Text dimColor>{p.name}</Text>}
            </Box>
          )
        })}
      </Box>
      <Box><Text dimColor>      which tool this account tracks</Text></Box>
    </Box>
  )
}

function FormField({ label, hint, value, focused, caret, accent, placeholder, mono }: {
  label: string; hint: string; value: string; focused: boolean; caret?: number; accent: string; placeholder: string; mono?: boolean
}) {
  const isPlaceholder = value === ''
  const display = isPlaceholder ? placeholder : value
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? accent : undefined} bold={focused} dimColor={!focused}>
          {focused ? glyphs().caretR : ' '} {label}
        </Text>
      </Box>
      <Box>
        <Text color={focused ? accent : undefined}>  {focused ? glyphs().vbar : ' '} </Text>
        {focused
          ? isPlaceholder
            ? <><Text color={accent}>{glyphs().vbar}</Text><Text dimColor italic={mono}>{placeholder}</Text></>
            : <CaretText value={value} caret={caret ?? value.length} color={accent} />
          : <Text dimColor={isPlaceholder} italic={mono && isPlaceholder}>{display}</Text>}
      </Box>
      <Box><Text dimColor>      {hint}</Text></Box>
    </Box>
  )
}

function ColorField({ value, focused }: { value: string; focused: boolean }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? value : undefined} bold={focused} dimColor={!focused}>
          {focused ? glyphs().caretR : ' '} Accent color
        </Text>
      </Box>
      <Box>
        <Text>  {focused ? glyphs().vbar : ' '} </Text>
        {COLOR_PALETTE.map(c => (
          <Box key={c} marginRight={1}>
            {c === value ? <Text bold color={c}>[{glyphs().dot}]</Text> : <Text color={c} dimColor={!focused}> {glyphs().dot}</Text>}
          </Box>
        ))}
      </Box>
      <Box><Text dimColor>      shows on dashboard, account strip, borders</Text></Box>
    </Box>
  )
}
