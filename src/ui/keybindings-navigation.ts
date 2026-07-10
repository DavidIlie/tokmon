import { TABS, VIEWS } from '../app.logic'
import { openUrl, REPO_URL } from './terminal'
import type { InputKey, KeyContext } from './keybinding-context'

export function handleGlobalCommand(input: string, ctx: KeyContext): boolean {
  const { global, table, settings } = ctx
  if (input === 'q') { global.exit(); return true }
  if (input === 'O') { openUrl(REPO_URL); return true }
  if (input === 'W' || (input === 'w' && table.tab !== 1 && !settings.show)) {
    if (!global.showLoader && global.configReady) void global.toggleWeb()
    return true
  }
  return false
}

export function handleNavigation(input: string, key: InputKey, ctx: KeyContext): void {
  const { settings, table, dashboard, global } = ctx
  const { config, updateConfig, resetView, slots } = global
  if (input === config.privacyToggleKey) {
    updateConfig(current => ({ ...current, privacyMode: !current.privacyMode }))
    return
  }
  if (input === 's') { settings.setTab('general'); settings.setShow(true); settings.setCursor(-1); return }
  if (input === 'a') { global.cycleAccount(1); return }
  if (input === 'A') { global.cycleAccount(-1); return }
  if (key.tab) { global.setTab(current => (current + 1) % TABS.length); resetView(); return }
  if (input && /^[0-9]$/.test(input) && slots.length > 1) {
    const target = slots[parseInt(input, 10)]
    if (target) { updateConfig(current => ({ ...current, activeAccountId: target.id })); resetView() }
    return
  }
  if (table.tab === 0) {
    if (dashboard.paginated) {
      if (input === ']' || key.downArrow || key.pageDown) { dashboard.setPage(page => Math.min(dashboard.pageCount - 1, page + 1)); return }
      if (input === '[' || key.upArrow || key.pageUp) { dashboard.setPage(page => Math.max(0, page - 1)); return }
    }
    if (key.upArrow || key.downArrow || key.pageUp || key.pageDown || input === 'G' || input === 'g') return
  }
  if (table.tab !== 1) {
    if (key.leftArrow || key.rightArrow) { global.setTab(current => (current + 1) % TABS.length); resetView() }
    return
  }

  if (input === 'p') { table.cycleProvider(1); return }
  if (input === 'P') { table.cycleProvider(-1); return }
  if (input === '/') { table.setSearchMode(true); table.setSearchCaret(table.search.length); return }
  if (key.escape) {
    if (table.search) { table.setSearch(''); table.setSearchCaret(0) }
    else table.setExpanded(-1)
    return
  }
  if (input === 'o') { table.setSort(sort => (sort + 1) % table.sorts.length); resetView(); return }
  if (input === 'd') { table.setView(0); resetView(); return }
  if (input === 'w') { table.setView(1); resetView(); return }
  if (input === 'm') { table.cycleModel(1); return }
  if (input === 'M') { table.cycleModel(-1); return }
  if (key.leftArrow) { table.setView(view => (view - 1 + VIEWS.length) % VIEWS.length); resetView(); return }
  if (key.rightArrow) { table.setView(view => (view + 1) % VIEWS.length); resetView(); return }
  if (key.return) { table.setExpanded(expanded => expanded === table.cursor ? -1 : table.cursor); return }
  if (key.upArrow) { table.setCursor(cursor => Math.max(0, cursor - 1)); return }
  if (key.downArrow) { table.setCursor(cursor => table.clampRow(cursor + 1)); return }
  if (key.pageDown || input === 'G') {
    table.setCursor(cursor => table.clampRow(input === 'G' ? table.rowCountRef.current - 1 : cursor + Math.max(1, table.rows - 12)))
    return
  }
  if (key.pageUp || input === 'g') {
    table.setCursor(cursor => input === 'g' ? 0 : Math.max(0, cursor - Math.max(1, table.rows - 12)))
  }
}
