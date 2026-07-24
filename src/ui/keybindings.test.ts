import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULTS, type Config } from '../config'
import {
  handleKey,
  handleTerminalFocusInput,
  isRefreshAllShortcut,
  terminalFocusEvent,
  type InputKey,
  type KeyContext,
} from './keybindings'
import { DESKTOP_FIXED_ROWS, DESKTOP_FIXED_SETTINGS } from './settings'

test('terminal focus reports are recognized without becoming text input', () => {
  assert.equal(terminalFocusEvent('[I'), 'in')
  assert.equal(terminalFocusEvent('[O'), 'out')
  assert.equal(terminalFocusEvent('I'), null)
  assert.equal(terminalFocusEvent('r'), null)
  assert.equal(handleTerminalFocusInput('[I'), true)
  assert.equal(handleTerminalFocusInput('[O'), true)
  assert.equal(handleTerminalFocusInput('r'), false)
})

const navigation = {
  showPicker: false,
  editingAccount: false,
  editingTimezone: false,
  editingSearch: false,
}

test('lowercase and uppercase R are refresh-all shortcuts', () => {
  assert.equal(isRefreshAllShortcut('R', navigation), true)
  assert.equal(isRefreshAllShortcut('r', navigation), true)
  assert.equal(isRefreshAllShortcut('RR', navigation), false)
  assert.equal(isRefreshAllShortcut('', navigation), false)
})

test('r and R remain text inside editors and do not escape onboarding', () => {
  for (const input of ['r', 'R']) {
    assert.equal(isRefreshAllShortcut(input, { ...navigation, showPicker: true }), false)
    assert.equal(isRefreshAllShortcut(input, { ...navigation, editingAccount: true }), false)
    assert.equal(isRefreshAllShortcut(input, { ...navigation, editingTimezone: true }), false)
    assert.equal(isRefreshAllShortcut(input, { ...navigation, editingSearch: true }), false)
    assert.equal(isRefreshAllShortcut(input, { ...navigation, unavailable: true }), false)
  }
})

const key: InputKey = {
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
  pageUp: false, pageDown: false, return: false, escape: false, tab: false,
  shift: false, ctrl: false, meta: false, backspace: false, delete: false,
}

function context(): KeyContext {
  const set = (() => {}) as never
  return {
    onboarding: { show: false, providers: [], cursor: 0, setCursor: set, toggle: () => {}, confirm: () => {} },
    accountEditor: {
      form: null, setForm: set, commit: () => {}, cycleField: () => {},
      cycleProvider: () => {}, cycleColor: () => {},
    },
    timezoneEditor: {
      value: null, setValue: set, setError: set, setCaret: set,
      valueRef: { current: '' }, caretRef: { current: 0 },
    },
    allowedHostsEditor: {
      value: null, setValue: set, setError: set, setCaret: set,
      valueRef: { current: '' }, caretRef: { current: 0 },
    },
    textInput: { isPrintable: () => true, insert: () => {} },
    settings: {
      show: false, setShow: set, cursor: 0, tab: 'general', setTab: set, setCursor: set,
      trackedAccounts: [], moveAccount: () => {}, toggleProvider: () => {},
      openEditAccount: () => {}, openConfigureAccount: () => {}, deleteAccount: () => {}, openAddAccount: () => {},
    },
    table: {
      tab: 0, searchMode: false, setSearchMode: set, search: '', setSearch: set,
      setSearchCaret: set, searchValueRef: { current: '' }, searchCaretRef: { current: 0 },
      cycleProvider: () => {}, setExpanded: set, setSort: set,
      sorts: [{ label: 'date', dir: null }], cycleModel: () => {}, setView: set,
      cursor: 0, rowCountRef: { current: 0 }, rows: 24, setCursor: set, clampRow: value => value,
    },
    dashboard: { paginated: false, pageCount: 1, setPage: set },
    global: {
      exit: () => {}, showLoader: false, configReady: true, toggleWeb: async () => {},
      config: DEFAULTS, updateConfig: () => {}, cycleAccount: () => {}, setTab: set,
      resetView: () => {}, slots: [], refreshAll: () => {},
    },
  }
}

test('the exported router dispatches r and R in navigation modes', () => {
  const ctx = context()
  let refreshes = 0
  ctx.global.refreshAll = () => { refreshes++ }
  handleKey('R', key, ctx)
  handleKey('r', key, ctx)
  assert.equal(refreshes, 2)
})

test('the exported router sends r and R to search text instead of refresh', () => {
  const ctx = context()
  let refreshes = 0
  let inserted = ''
  ctx.global.refreshAll = () => { refreshes++ }
  ctx.table.tab = 1
  ctx.table.searchMode = true
  ctx.textInput.insert = value => { inserted += value }
  handleKey('r', key, ctx)
  handleKey('R', key, ctx)
  assert.equal(inserted, 'rR')
  assert.equal(refreshes, 0)
})

test('the exported router keeps onboarding modal over refresh', () => {
  const ctx = context()
  let refreshes = 0
  ctx.global.refreshAll = () => { refreshes++ }
  ctx.onboarding.show = true
  handleKey('R', key, ctx)
  assert.equal(refreshes, 0)
})

test('theme settings persist preset, appearance, and terminal policy through config updates', () => {
  const ctx = context()
  let config = DEFAULTS
  ctx.settings.show = true
  ctx.settings.tab = 'theme'
  ctx.global.config = config
  ctx.global.updateConfig = updater => {
    config = updater(config)
    ctx.global.config = config
  }

  handleKey('', { ...key, rightArrow: true }, ctx)
  assert.equal(config.appearance.preset, 'phosphor')
  assert.equal(config.appearance.mode, 'dark')

  ctx.settings.cursor = 1
  handleKey('', { ...key, rightArrow: true }, ctx)
  assert.equal(config.appearance.mode, 'dark', 'phosphor remains dark-only')

  ctx.settings.cursor = 2
  handleKey('', { ...key, rightArrow: true }, ctx)
  assert.equal(config.appearance.terminal, 'dark')
})

test('desktop settings persist the complete menu-bar builder without duplicate pin rows', () => {
  const ctx = context()
  let config = structuredClone(DEFAULTS)
  ctx.settings.show = true
  ctx.settings.tab = 'desktop'
  ctx.global.config = config
  ctx.global.updateConfig = updater => {
    config = updater(config)
    ctx.global.config = config
  }

  const adjust = (rowKey: string, input = '', inputKey: InputKey = { ...key, rightArrow: true }) => {
    ctx.settings.cursor = DESKTOP_FIXED_SETTINGS.findIndex(row => row.key === rowKey)
    assert.notEqual(ctx.settings.cursor, -1, `missing ${rowKey}`)
    handleKey(input, inputKey, ctx)
  }

  adjust('menuBarMode')
  assert.equal(config.tray.menuBar.mode, 'custom')

  adjust('menuBarMark', ' ', key)
  assert.equal(config.tray.menuBar.elements.providerMark, false)

  adjust('menuBarProgress', ' ', key)
  assert.equal(config.tray.menuBar.elements.progress, true)

  adjust('menuBarValue', ' ', key)
  assert.equal(config.tray.showMenuBarText, false)
  assert.equal(config.tray.menuBar.elements.value, false)

  adjust('menuBarContent')
  assert.equal(config.tray.menuBarValue, 'todayTokens')

  adjust('menuBarDensity')
  assert.equal(config.tray.menuBar.density, 'compact')

  adjust('menuBarEdgePadding')
  adjust('menuBarMarkValueGap')
  adjust('menuBarProviderGap')
  assert.deepEqual(config.tray.menuBar.customSpacing, {
    edgePaddingPt: 1.5,
    markValueGapPt: 3.5,
    providerGapPt: 8.5,
  })

  adjust('summary')
  assert.equal(config.tray.displayMetric, 'tightestRemaining')

  adjust('graphRange')
  assert.equal(config.desktop.graphRangeDays, 30)

  assert.equal(DESKTOP_FIXED_ROWS, DESKTOP_FIXED_SETTINGS.length)
  assert.equal(DESKTOP_FIXED_SETTINGS.some(row => /pin/i.test(row.key + row.label)), false)
})

test('desktop menu-bar builder guards visibility, spacing bounds, and presentation-only reset', () => {
  const ctx = context()
  let config: Config = {
    ...structuredClone(DEFAULTS),
    tray: {
      ...structuredClone(DEFAULTS.tray),
      pinnedProviders: ['claude', 'codex'],
      menuBarValue: 'todayTokens',
      showMenuBarText: false,
      menuBar: {
        version: 1,
        mode: 'custom',
        elements: { providerMark: true, value: false, progress: false },
        density: 'tight',
        customSpacing: { edgePaddingPt: 6, markValueGapPt: 8, providerGapPt: 16 },
      },
    },
  }
  ctx.settings.show = true
  ctx.settings.tab = 'desktop'
  ctx.global.config = config
  ctx.global.updateConfig = updater => { config = updater(config); ctx.global.config = config }

  ctx.settings.cursor = DESKTOP_FIXED_SETTINGS.findIndex(row => row.key === 'menuBarMark')
  handleKey(' ', key, ctx)
  assert.deepEqual(config.tray.menuBar.elements, { providerMark: true, value: false, progress: false })

  for (const rowKey of ['menuBarEdgePadding', 'menuBarMarkValueGap', 'menuBarProviderGap']) {
    ctx.settings.cursor = DESKTOP_FIXED_SETTINGS.findIndex(row => row.key === rowKey)
    handleKey('', { ...key, rightArrow: true }, ctx)
  }
  assert.deepEqual(config.tray.menuBar.customSpacing, { edgePaddingPt: 6, markValueGapPt: 8, providerGapPt: 16 })

  ctx.settings.cursor = DESKTOP_FIXED_SETTINGS.findIndex(row => row.key === 'menuBarReset')
  handleKey('', { ...key, return: true }, ctx)
  assert.equal(config.tray.menuBar.mode, 'auto')
  assert.deepEqual(config.tray.menuBar.elements, { providerMark: true, value: true, progress: false })
  assert.equal(config.tray.showMenuBarText, true)
  assert.deepEqual(config.tray.pinnedProviders, ['claude', 'codex'])
  assert.equal(config.tray.menuBarValue, 'todayTokens')
})

test('provider settings separate tracking from global and per-provider discovery', () => {
  const ctx = context()
  let config = DEFAULTS
  ctx.settings.show = true
  ctx.settings.tab = 'providers'
  ctx.global.config = config
  ctx.global.updateConfig = updater => { config = updater(config); ctx.global.config = config }
  ctx.settings.toggleProvider = provider => ctx.global.updateConfig(current => ({
    ...current,
    disabledProviders: current.disabledProviders.includes(provider)
      ? current.disabledProviders.filter(id => id !== provider)
      : [...current.disabledProviders, provider],
  }))

  ctx.settings.cursor = 0
  handleKey(' ', key, ctx)
  assert.equal(config.accountDetection.enabled, false)
  handleKey(' ', key, ctx)
  assert.equal(config.accountDetection.enabled, true)

  ctx.settings.cursor = 1
  handleKey('a', key, ctx)
  assert.deepEqual(config.accountDetection.disabledProviders, ['claude'])
  assert.deepEqual(config.disabledProviders, [])
  handleKey(' ', key, ctx)
  assert.deepEqual(config.disabledProviders, ['claude'])
})

test('account settings can ignore and restore an automatically detected account', () => {
  const ctx = context()
  let config: Config = { ...DEFAULTS, activeAccountId: 'claude-alt' }
  ctx.settings.show = true
  ctx.settings.tab = 'accounts'
  ctx.settings.cursor = 0
  ctx.settings.trackedAccounts = [{
    id: 'claude-alt', providerId: 'claude', name: 'alt@example.com', homeDir: '/tmp/claude-alt',
    color: 'green', source: 'auto', enabled: true,
  }]
  ctx.global.config = config
  ctx.global.updateConfig = updater => { config = updater(config); ctx.global.config = config }

  handleKey('x', key, ctx)
  assert.equal(config.activeAccountId, null)
  assert.deepEqual(config.accountDetection.excludedAccounts, [{ providerId: 'claude', homeDir: '/tmp/claude-alt' }])

  ctx.settings.trackedAccounts = [{
    id: 'ignored:claude:/tmp/claude-alt', providerId: 'claude', name: 'Claude account', homeDir: '/tmp/claude-alt',
    color: 'green', source: 'ignored', enabled: false, excludedRef: { providerId: 'claude', homeDir: '/tmp/claude-alt' },
  }]
  handleKey('x', key, ctx)
  assert.deepEqual(config.accountDetection.excludedAccounts, [])
})

test('general settings dispatch is index-aligned with the declarative schema', () => {
  const ctx = context()
  let config = DEFAULTS
  ctx.settings.show = true
  ctx.settings.tab = 'general'
  ctx.global.config = config
  ctx.global.updateConfig = updater => { config = updater(config); ctx.global.config = config }

  // row 0 — refresh interval: right increments, left decrements with a floor of 1.
  ctx.settings.cursor = 0
  handleKey('', { ...key, rightArrow: true }, ctx)
  assert.equal(config.interval, 3)
  handleKey('', { ...key, leftArrow: true }, ctx)
  handleKey('', { ...key, leftArrow: true }, ctx)
  handleKey('', { ...key, leftArrow: true }, ctx)
  assert.equal(config.interval, 1, 'floored at 1')

  // row 2 — clear screen toggles on return.
  ctx.settings.cursor = 2
  handleKey('', { ...key, return: true }, ctx)
  assert.equal(config.clearScreen, false)

  // row 3 — privacy mode toggles.
  ctx.settings.cursor = 3
  handleKey('', { ...key, rightArrow: true }, ctx)
  assert.equal(config.privacyMode, false)

  // row 6 — dashboard layout toggles grid/single.
  ctx.settings.cursor = 6
  handleKey('', { ...key, return: true }, ctx)
  assert.equal(config.dashboardLayout, 'single')

  // row 8 — network access toggles.
  ctx.settings.cursor = 8
  handleKey('', { ...key, rightArrow: true }, ctx)
  assert.equal(config.allowNetworkAccess, true)

  // row 10 — reset display toggles relative/absolute.
  ctx.settings.cursor = 10
  handleKey('', { ...key, rightArrow: true }, ctx)
  assert.equal(config.resetDisplay, 'absolute')
})

test('general privacy-key row captures a printable and resets on delete', () => {
  const ctx = context()
  let config = DEFAULTS
  ctx.settings.show = true
  ctx.settings.tab = 'general'
  ctx.settings.cursor = 4
  ctx.global.config = config
  ctx.global.updateConfig = updater => { config = updater(config); ctx.global.config = config }
  ctx.textInput.isPrintable = () => true

  handleKey('x', key, ctx)
  assert.equal(config.privacyToggleKey, 'x')
  handleKey('', { ...key, backspace: true }, ctx)
  assert.equal(config.privacyToggleKey, 'p')
})

test('general timezone and allowed-hosts rows open their editors on return', () => {
  const ctx = context()
  ctx.settings.show = true
  ctx.settings.tab = 'general'
  ctx.global.config = { ...DEFAULTS, timezone: 'UTC', allowedHosts: ['a.example'] }

  let tzOpened: unknown = undefined
  ctx.timezoneEditor.setValue = ((value: unknown) => { tzOpened = value }) as never
  ctx.settings.cursor = 5
  handleKey('', { ...key, return: true }, ctx)
  assert.equal(tzOpened, 'UTC')

  let hostsOpened: unknown = undefined
  ctx.allowedHostsEditor.setValue = ((value: unknown) => { hostsOpened = value }) as never
  ctx.settings.cursor = 9
  handleKey('', { ...key, return: true }, ctx)
  assert.equal(hostsOpened, 'a.example')
})
