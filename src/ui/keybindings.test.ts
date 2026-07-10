import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULTS } from '../config'
import { handleKey, isRefreshAllShortcut, type InputKey, type KeyContext } from './keybindings'

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
