import { withTimeout } from './async'
import { attachOrSpawn } from './client/daemon-handle'
import { createDaemonRpcClient, type DaemonRpcClient } from './client/daemon-rpc-client'
import {
  configLocation, DESKTOP_GRAPH_RANGES, MENU_BAR_SPACING_MAX_PT,
  patchMenuBarPresentation, setMenuBarValue, setProviderDetectionEnabled, setProviderTrackingEnabled,
  type Config, type MenuBarSpacingField,
} from './config'
import { parseQueryArgs, type ParsedQueryArgs } from './cli-command-args'
import { PROVIDER_IDS, type ProviderId } from './providers/types'
import type { ConfigState, ConfigUpdateRequest } from './rpc/contract'

export interface ConfigCommandDependencies {
  configPath?: () => string
  connectConfig?: typeof connectDaemonConfig
}

type ConfigClient = Pick<DaemonRpcClient, 'getConfig' | 'setConfig' | 'close'>

export const CONFIG_HELP = `tokmon config - Read and update tokmon settings

Usage:
  tokmon config [path]
  tokmon config --json
  tokmon config get [--json]
  tokmon config set <setting> <value> [--json]

Settings:
  privacy <on|off>
  privacy-key <char>
  menu-bar-mode <auto|custom>
  menu-bar-elements <list>       mark,value,progress; at least one
  menu-bar-density <comfortable|compact|tight>
  menu-bar-edge-padding <points> 0..${MENU_BAR_SPACING_MAX_PT.edgePaddingPt} in 0.5pt increments
  menu-bar-mark-value-gap <points> 0..${MENU_BAR_SPACING_MAX_PT.markValueGapPt} in 0.5pt increments
  menu-bar-provider-gap <points> 0..${MENU_BAR_SPACING_MAX_PT.providerGapPt} in 0.5pt increments
  menu-bar-value <usage|tokens-today>
  summary-mode <smart|tightest>
  expanded-providers <ids|none>  Comma-separated provider ids
  active-window <minutes>        1..1440
  graph-range <7|14|30>          Desktop spend graph days
  enabled-providers <ids|none>   Providers tracked across every surface
  auto-detect <on|off>           Automatic account discovery
  auto-detect-providers <ids|none>
  launch-at-login <on|off>

Compatibility:
  menu-bar-text <on|off>         Deprecated alias for the value element
  menu-bar-pins <ids|none>       Deprecated; pin from desktop provider cards

Options:
      --json                    Emit machine-readable JSON
      --compact                 Emit compact JSON
      --timeout <seconds>       Daemon connection timeout (default: 45)
  -h, --help                    Show this help

Examples:
  tokmon config get
  tokmon config set privacy off
  tokmon config set menu-bar-elements mark,value,progress
  tokmon config set summary-mode smart --json
`

type ConfigSetting =
  | 'privacy'
  | 'privacy-key'
  | 'menu-bar-pins'
  | 'menu-bar-text'
  | 'menu-bar-value'
  | 'menu-bar-mode'
  | 'menu-bar-elements'
  | 'menu-bar-density'
  | 'menu-bar-edge-padding'
  | 'menu-bar-mark-value-gap'
  | 'menu-bar-provider-gap'
  | 'summary-mode'
  | 'expanded-providers'
  | 'active-window'
  | 'graph-range'
  | 'enabled-providers'
  | 'auto-detect'
  | 'auto-detect-providers'
  | 'launch-at-login'

const CONFIG_SETTINGS: readonly ConfigSetting[] = [
  'privacy',
  'privacy-key',
  'menu-bar-pins',
  'menu-bar-text',
  'menu-bar-value',
  'menu-bar-mode',
  'menu-bar-elements',
  'menu-bar-density',
  'menu-bar-edge-padding',
  'menu-bar-mark-value-gap',
  'menu-bar-provider-gap',
  'summary-mode',
  'expanded-providers',
  'active-window',
  'graph-range',
  'enabled-providers',
  'auto-detect',
  'auto-detect-providers',
  'launch-at-login',
]

interface ConfigReport {
  revision: number
  privacy: 'on' | 'off'
  privacyKey: string
  menuBarPins: string[]
  menuBarText: 'on' | 'off'
  menuBarValue: 'usage' | 'tokens-today'
  menuBarMode: 'auto' | 'custom'
  menuBarElements: string[]
  menuBarDensity: 'comfortable' | 'compact' | 'tight'
  menuBarEdgePaddingPt: number
  menuBarMarkValueGapPt: number
  menuBarProviderGapPt: number
  summaryMode: 'smart' | 'tightest'
  expandedProviders: string[]
  activeWindowMinutes: number
  graphRangeDays: 7 | 14 | 30
  enabledProviders: ProviderId[]
  autoDetect: 'on' | 'off'
  autoDetectProviders: ProviderId[]
  launchAtLogin: 'on' | 'off'
}

function configReport(config: Config): ConfigReport {
  return {
    revision: config.revision,
    privacy: config.privacyMode ? 'on' : 'off',
    privacyKey: config.privacyToggleKey,
    menuBarPins: [...config.tray.pinnedProviders],
    menuBarText: config.tray.showMenuBarText ? 'on' : 'off',
    menuBarValue: config.tray.menuBarValue === 'todayTokens' ? 'tokens-today' : 'usage',
    menuBarMode: config.tray.menuBar.mode,
    menuBarElements: [
      ...(config.tray.menuBar.elements.providerMark ? ['mark'] : []),
      ...(config.tray.menuBar.elements.value ? ['value'] : []),
      ...(config.tray.menuBar.elements.progress ? ['progress'] : []),
    ],
    menuBarDensity: config.tray.menuBar.density,
    menuBarEdgePaddingPt: config.tray.menuBar.customSpacing.edgePaddingPt,
    menuBarMarkValueGapPt: config.tray.menuBar.customSpacing.markValueGapPt,
    menuBarProviderGapPt: config.tray.menuBar.customSpacing.providerGapPt,
    summaryMode: config.tray.displayMetric === 'smartHeadroom' ? 'smart' : 'tightest',
    expandedProviders: [...config.desktop.expandedProviders],
    activeWindowMinutes: config.tray.activeTimeoutMin,
    graphRangeDays: config.desktop.graphRangeDays,
    enabledProviders: PROVIDER_IDS.filter(id => !config.disabledProviders.includes(id)),
    autoDetect: config.accountDetection.enabled ? 'on' : 'off',
    autoDetectProviders: PROVIDER_IDS.filter(id => !config.accountDetection.disabledProviders.includes(id)),
    launchAtLogin: config.tray.launchAtLogin ? 'on' : 'off',
  }
}

function formatConfigReport(report: ConfigReport): string {
  const list = (values: readonly string[]) => values.length > 0 ? values.join(',') : 'none'
  return [
    `privacy             ${report.privacy}`,
    `privacy-key         ${report.privacyKey}`,
    `menu-bar-mode       ${report.menuBarMode}`,
    `menu-bar-elements   ${list(report.menuBarElements)}`,
    `menu-bar-density    ${report.menuBarDensity}`,
    `menu-bar-edge-padding ${report.menuBarEdgePaddingPt}pt`,
    `menu-bar-mark-value-gap ${report.menuBarMarkValueGapPt}pt`,
    `menu-bar-provider-gap ${report.menuBarProviderGapPt}pt`,
    `menu-bar-value      ${report.menuBarValue}`,
    `summary-mode        ${report.summaryMode}`,
    `expanded-providers  ${list(report.expandedProviders)}`,
    `active-window       ${report.activeWindowMinutes}m`,
    `graph-range         ${report.graphRangeDays}d`,
    `enabled-providers   ${list(report.enabledProviders)}`,
    `auto-detect         ${report.autoDetect}`,
    `auto-detect-providers ${list(report.autoDetectProviders)}`,
    `launch-at-login     ${report.launchAtLogin}`,
  ].join('\n') + '\n'
}

function onOff(value: string, setting: ConfigSetting): boolean {
  if (value === 'on') return true
  if (value === 'off') return false
  throw new Error(`${setting} must be on or off`)
}

function providerList(value: string, setting: ConfigSetting, max: number = PROVIDER_IDS.length): ProviderId[] {
  if (value === 'none') return []
  const raw = value.split(',').map(item => item.trim())
  if (raw.length === 0 || raw.some(item => item.length === 0)) {
    throw new Error(`${setting} must be a comma-separated provider list or none`)
  }
  const unique = [...new Set(raw)]
  for (const provider of unique) {
    if (!PROVIDER_IDS.includes(provider as ProviderId)) throw new Error(`unknown provider: ${provider}`)
  }
  if (unique.length > max) throw new Error(`${setting} accepts at most ${max} providers`)
  return unique as ProviderId[]
}

function menuBarElements(value: string): Array<'mark' | 'value' | 'progress'> {
  if (value === 'none') throw new Error('menu-bar-elements must include at least one of mark,value,progress')
  const raw = value.split(',').map(item => item.trim())
  if (raw.length === 0 || raw.some(item => item.length === 0)) {
    throw new Error('menu-bar-elements must list at least one of mark,value,progress')
  }
  const unique = [...new Set(raw)]
  for (const element of unique) {
    if (element !== 'mark' && element !== 'value' && element !== 'progress') {
      throw new Error(`unknown menu-bar element: ${element}`)
    }
  }
  return unique as Array<'mark' | 'value' | 'progress'>
}

function halfPoint(value: string, setting: ConfigSetting, max: number): number {
  const points = Number(value)
  if (value.trim() === '' || !Number.isFinite(points) || points < 0 || points > max || !Number.isInteger(points * 2)) {
    throw new Error(`${setting} must be from 0 to ${max} in 0.5pt increments`)
  }
  return points
}

function settingMutation(setting: ConfigSetting, value: string): { mutate(config: Config): Config; display: string | number | string[] } {
  if (setting === 'privacy') {
    const enabled = onOff(value, setting)
    return { mutate: config => ({ ...config, privacyMode: enabled }), display: value }
  }
  if (setting === 'privacy-key') {
    if (value.length !== 1 || /\s|\p{Cc}/u.test(value)) throw new Error('privacy-key must be one printable non-whitespace character')
    return { mutate: config => ({ ...config, privacyToggleKey: value }), display: value }
  }
  if (setting === 'menu-bar-pins') {
    const providers = providerList(value, setting, 2)
    return {
      mutate: config => ({
        ...config,
        tray: { ...config.tray, pinnedProviders: providers, pins: [], pinnedAccount: null },
      }),
      display: providers,
    }
  }
  if (setting === 'menu-bar-text') {
    const enabled = onOff(value, setting)
    return {
      mutate: config => ({
        ...config,
        tray: (() => {
          const elements = { ...config.tray.menuBar.elements, value: enabled }
          if (!Object.values(elements).some(Boolean)) throw new Error('menu-bar-text off would hide every menu-bar element')
          return {
            ...config.tray,
            showMenuBarText: enabled,
            menuBar: { ...config.tray.menuBar, elements },
          }
        })(),
      }),
      display: value,
    }
  }
  if (setting === 'menu-bar-value') {
    if (value !== 'usage' && value !== 'tokens-today') throw new Error('menu-bar-value must be usage or tokens-today')
    const menuBarValue = value === 'tokens-today' ? 'todayTokens' : 'usage'
    return { mutate: config => setMenuBarValue(config, menuBarValue), display: value }
  }
  if (setting === 'menu-bar-mode') {
    if (value !== 'auto' && value !== 'custom') throw new Error('menu-bar-mode must be auto or custom')
    return { mutate: config => patchMenuBarPresentation(config, { mode: value }), display: value }
  }
  if (setting === 'menu-bar-elements') {
    const selected = menuBarElements(value)
    // Written as one atomic patch: applying the three toggles in sequence would let
    // the shared last-element guard refuse an intermediate step and silently succeed.
    const elements = {
      providerMark: selected.includes('mark'),
      value: selected.includes('value'),
      progress: selected.includes('progress'),
    }
    return { mutate: config => patchMenuBarPresentation(config, { elements }), display: selected }
  }
  if (setting === 'menu-bar-density') {
    if (value !== 'comfortable' && value !== 'compact' && value !== 'tight') {
      throw new Error('menu-bar-density must be comfortable, compact, or tight')
    }
    return { mutate: config => patchMenuBarPresentation(config, { density: value }), display: value }
  }
  if (setting === 'menu-bar-edge-padding' || setting === 'menu-bar-mark-value-gap' || setting === 'menu-bar-provider-gap') {
    const field: MenuBarSpacingField = setting === 'menu-bar-edge-padding'
      ? 'edgePaddingPt'
      : setting === 'menu-bar-mark-value-gap'
        ? 'markValueGapPt'
        : 'providerGapPt'
    const points = halfPoint(value, setting, MENU_BAR_SPACING_MAX_PT[field])
    return {
      mutate: config => patchMenuBarPresentation(config, { mode: 'custom', customSpacing: { [field]: points } }),
      display: points,
    }
  }
  if (setting === 'summary-mode') {
    if (value !== 'smart' && value !== 'tightest') throw new Error('summary-mode must be smart or tightest')
    const displayMetric = value === 'smart' ? 'smartHeadroom' : 'tightestRemaining'
    return { mutate: config => ({ ...config, tray: { ...config.tray, displayMetric } }), display: value }
  }
  if (setting === 'expanded-providers') {
    const providers = providerList(value, setting)
    return {
      mutate: config => ({ ...config, desktop: { ...config.desktop, expandedProviders: providers } }),
      display: providers,
    }
  }
  if (setting === 'active-window') {
    const minutes = Number(value)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1_440) throw new Error('active-window must be an integer from 1 to 1440 minutes')
    return { mutate: config => ({ ...config, tray: { ...config.tray, activeTimeoutMin: minutes } }), display: minutes }
  }
  if (setting === 'graph-range') {
    const days = Number(value)
    if (!DESKTOP_GRAPH_RANGES.includes(days as Config['desktop']['graphRangeDays'])) throw new Error('graph-range must be 7, 14, or 30 days')
    return {
      mutate: config => ({ ...config, desktop: { ...config.desktop, graphRangeDays: days as Config['desktop']['graphRangeDays'] } }),
      display: days,
    }
  }
  if (setting === 'auto-detect') {
    const enabled = onOff(value, setting)
    return {
      mutate: config => ({ ...config, accountDetection: { ...config.accountDetection, enabled } }),
      display: value,
    }
  }
  if (setting === 'enabled-providers') {
    const enabled = providerList(value, setting)
    return {
      mutate: config => PROVIDER_IDS.reduce(
        (next, provider) => setProviderTrackingEnabled(next, provider, enabled.includes(provider)),
        config,
      ),
      display: enabled,
    }
  }
  if (setting === 'auto-detect-providers') {
    const enabled = providerList(value, setting)
    return {
      mutate: config => ({
        ...config,
        accountDetection: PROVIDER_IDS.reduce(
          (next, provider) => setProviderDetectionEnabled(next, provider, enabled.includes(provider)),
          config.accountDetection,
        ),
      }),
      display: enabled,
    }
  }
  if (setting !== 'launch-at-login') throw new Error(`unsupported config setting: ${setting}`)
  const enabled = onOff(value, setting)
  return { mutate: config => ({ ...config, tray: { ...config.tray, launchAtLogin: enabled } }), display: value }
}

export async function connectDaemonConfig(timeoutMs: number): Promise<ConfigClient> {
  const handle = await attachOrSpawn({ timeoutMs })
  if (handle.kind !== 'spawned' || !handle.baseUrl) throw new Error(handle.issue?.message ?? 'tokmon daemon is unavailable')
  return createDaemonRpcClient(handle.baseUrl, {
    transport: 'node',
    reconnectAttempts: 2,
    reconnectBaseDelayMs: 100,
  })
}

function isConfigConflict(cause: unknown): boolean {
  return !!cause && typeof cause === 'object' && (cause as { kind?: unknown }).kind === 'conflict'
}

async function readDaemonConfig(
  timeoutMs: number,
  connect: typeof connectDaemonConfig,
): Promise<{
  state: ConfigState
  close(): Promise<void>
  get(): Promise<ConfigState>
  set(update: ConfigUpdateRequest): Promise<ConfigState>
}> {
  const client = await connect(timeoutMs)
  try {
    const state = await withTimeout(client.getConfig(), timeoutMs)
    return {
      state,
      close: () => client.close(),
      get: () => withTimeout(client.getConfig(), timeoutMs),
      set: update => withTimeout(client.setConfig(update), timeoutMs),
    }
  } catch (cause) {
    await client.close().catch(() => {})
    throw cause
  }
}

function json(value: unknown, compact: boolean): string {
  return JSON.stringify(value, null, compact ? undefined : 2) + '\n'
}

function rejectsOption(args: string[], names: string[]): string | null {
  for (const arg of args) {
    const name = names.find(candidate => arg === candidate || arg.startsWith(`${candidate}=`))
    if (name) return name
  }
  return null
}

async function executeConfigCommand(
  args: ParsedQueryArgs,
  configPath: () => string,
  connect: typeof connectDaemonConfig,
): Promise<string> {
  const [action, settingName, value, ...extra] = args.positionals
  if (!action || action === 'path') {
    if (settingName || value || extra.length > 0) throw new Error('usage: tokmon config [path] [--json]')
    return args.json ? json({ path: configPath() }, args.compact) : `${configPath()}\n`
  }
  if (action !== 'get' && action !== 'set') throw new Error('usage: tokmon config [path|get|set]')
  if (action === 'get') {
    if (settingName || value || extra.length > 0) throw new Error('usage: tokmon config get [--json]')
    const daemon = await readDaemonConfig(args.timeoutMs, connect)
    try {
      const report = configReport(daemon.state.config)
      return args.json ? json(report, args.compact) : formatConfigReport(report)
    } finally {
      await daemon.close().catch(() => {})
    }
  }
  if (!settingName || !CONFIG_SETTINGS.includes(settingName as ConfigSetting) || value === undefined || extra.length > 0) {
    throw new Error('usage: tokmon config set <setting> <value>')
  }
  const setting = settingName as ConfigSetting
  const update = settingMutation(setting, value)
  const daemon = await readDaemonConfig(args.timeoutMs, connect)
  try {
    let base = daemon.state
    let saved: ConfigState | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        saved = await daemon.set({
          expectedRevision: base.config.revision,
          config: update.mutate(base.config),
        })
        break
      } catch (cause) {
        if (attempt > 0 || !isConfigConflict(cause)) throw cause
        // A field-scoped command can safely reapply itself to one fresh daemon state.
        base = await daemon.get()
      }
    }
    if (!saved) throw new Error('config update failed')
    const result = { setting, value: update.display, revision: saved.config.revision }
    return args.json ? json(result, args.compact) : `${setting} ${Array.isArray(update.display) ? update.display.join(',') || 'none' : update.display}\n`
  } finally {
    await daemon.close().catch(() => {})
  }
}

export async function runConfigCommand(
  args: string[],
  dependencies: ConfigCommandDependencies = {},
): Promise<string> {
  const parsed = parseQueryArgs(args)
  if (parsed.help) return CONFIG_HELP
  const invalid = rejectsOption(args, ['--period', '--provider', '--account', '--model', '--refresh', '--cached', '--no-refresh'])
  if (invalid) throw new Error(`${invalid} is not valid for tokmon config`)
  return executeConfigCommand(
    parsed,
    dependencies.configPath ?? configLocation,
    dependencies.connectConfig ?? connectDaemonConfig,
  )
}
