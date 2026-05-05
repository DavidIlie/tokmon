import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useInput, useStdout, useApp, type DOMElement } from 'ink'
import { useMouse, useOnMouseClick } from '@zenobius/ink-mouse'
import { fetchDashboard, fetchTable, type DashboardData, type TableData } from './data'
import { fetchBilling, type BillingData, type PeakStatus } from './billing'
import {
  loadConfig, saveConfig, configLocation,
  generateAccountId, pickAccentColor, expandHome,
  type Config, type Account,
} from './config'
import { resolveTimezone, isValidTimezone, systemTimezone } from './tz'
import * as fmt from './format'
import type { UsageSummary, TableRow } from './types'

const TABS = ['Dashboard', 'Table'] as const
const VIEWS = ['Daily', 'Weekly', 'Monthly'] as const
const SORTS = ['date ↑', 'date ↓', 'cost ↑', 'cost ↓'] as const
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DEFAULT_CONFIG: Config = {
  interval: 2, billingInterval: 5, clearScreen: true, timezone: null,
  accounts: [], activeAccountId: null,
}
const GENERAL_ROWS = 4
const IS_TTY = process.stdin.isTTY === true

type AccountSlot = { id: string | null; name: string; homeDir: string | undefined; color: string }

function buildSlots(config: Config): AccountSlot[] {
  const slots: AccountSlot[] = []
  if (config.accounts.length === 0) {
    slots.push({ id: null, name: 'Default', homeDir: undefined, color: 'green' })
    return slots
  }
  slots.push({ id: null, name: 'All', homeDir: undefined, color: 'whiteBright' })
  for (const a of config.accounts) {
    slots.push({
      id: a.id,
      name: a.name,
      homeDir: expandHome(a.homeDir),
      color: a.color || 'cyan',
    })
  }
  return slots
}

interface AccountStats {
  slot: AccountSlot
  dashboard: DashboardData | null
  billing: BillingData | null
}

export function App({ interval: cliInterval }: { interval?: number }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [stats, setStats] = useState<Map<string, AccountStats>>(new Map())
  const [table, setTable] = useState<TableData | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(new Date())
  const [tab, setTab] = useState(0)
  const [view, setView] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [expanded, setExpanded] = useState(-1)
  const [sort, setSort] = useState(1)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsCursor, setSettingsCursor] = useState(0)
  const [tzEdit, setTzEdit] = useState<string | null>(null)
  const [tzError, setTzError] = useState<string | null>(null)
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null)
  const tableLoadedOnce = useRef(false)
  const { stdout } = useStdout()
  const { exit } = useApp()
  const rows = stdout?.rows ?? 24
  const cols = stdout?.columns ?? 80

  const cfg = config ?? DEFAULT_CONFIG
  const interval = cliInterval ?? cfg.interval * 1000
  const tz = resolveTimezone(cfg.timezone)
  const slots = buildSlots(cfg)
  const activeSlotIdx = (() => {
    if (cfg.accounts.length === 0) return 0
    if (cfg.activeAccountId === null) return 0
    const i = slots.findIndex(s => s.id === cfg.activeAccountId)
    return i < 0 ? 0 : i
  })()
  const activeSlot = slots[activeSlotIdx]
  const slotKey = (s: AccountSlot) => s.id ?? '__default__'
  const visibleSlots: AccountSlot[] = activeSlot.id === null && cfg.accounts.length > 0
    ? slots.slice(1)
    : [activeSlot]

  useEffect(() => {
    loadConfig().then(c => {
      if (cliInterval) c = { ...c, interval: cliInterval / 1000 }
      setConfig(c)
    })
  }, [])

  useEffect(() => {
    if (!config) return
    let active = true
    const slotsToLoad = activeSlot.id === null && cfg.accounts.length > 0 ? slots.slice(1) : [activeSlot]
    const load = async () => {
      try {
        const next = new Map<string, AccountStats>()
        await Promise.all(slotsToLoad.map(async (slot) => {
          const [dashboard, billing] = await Promise.all([
            fetchDashboard(tz, slot.homeDir),
            fetchBilling(slot.homeDir),
          ])
          next.set(slotKey(slot), { slot, dashboard, billing })
        }))
        if (active) {
          setStats(next)
          setError(null)
          setUpdated(new Date())
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const id = setInterval(load, interval)
    return () => { active = false; clearInterval(id) }
  }, [interval, tz, config, activeSlot.id])

  useEffect(() => {
    tableLoadedOnce.current = false
    setTable(null)
  }, [tz, activeSlot.id])

  useEffect(() => {
    if (tab !== 1) return
    if (tableLoadedOnce.current && table) return
    let active = true
    setTableLoading(true)
    fetchTable(tz, activeSlot.id === null ? undefined : activeSlot.homeDir).then(result => {
      if (active) { setTable(result); setTableLoading(false); tableLoadedOnce.current = true }
    }).catch(() => { if (active) setTableLoading(false) })
    return () => { active = false }
  }, [tab, tz, activeSlot.id])

  useEffect(() => {
    if (tab !== 1 || !tableLoadedOnce.current) return
    let active = true
    const id = setInterval(async () => {
      try {
        const result = await fetchTable(tz, activeSlot.id === null ? undefined : activeSlot.homeDir)
        if (active) setTable(result)
      } catch {}
    }, Math.max(interval, 10000))
    return () => { active = false; clearInterval(id) }
  }, [tab, interval, tz, activeSlot.id])

  const resetView = useCallback(() => {
    setCursor(0)
    setExpanded(-1)
  }, [])

  const mouse = useMouse()

  useEffect(() => {
    if (!IS_TTY) return
    mouse.enable()
    const onScroll = (_pos: { x: number; y: number }, dir: string | null) => {
      if (tab === 1) {
        setCursor(c => dir === 'scrollup' ? Math.max(0, c - 3) : c + 3)
      }
    }
    mouse.events.on('scroll', onScroll)
    return () => { mouse.events.off('scroll', onScroll) }
  }, [tab])

  function updateConfig(fn: (prev: Config) => Config): void {
    setConfig(prev => {
      const next = fn(prev ?? DEFAULT_CONFIG)
      saveConfig(next)
      return next
    })
  }

  function cycleAccount(dir: 1 | -1): void {
    if (slots.length <= 1) return
    const next = (activeSlotIdx + dir + slots.length) % slots.length
    const targetId = slots[next].id
    updateConfig(c => ({ ...c, activeAccountId: targetId }))
    resetView()
  }

  // Account form handlers
  function openAddAccount(): void {
    setAccountForm({
      mode: 'add', field: 'name',
      name: '', homeDir: '~',
      color: pickAccentColor(cfg.accounts),
      editingId: null, error: null,
    })
  }
  function openEditAccount(acc: Account): void {
    setAccountForm({
      mode: 'edit', field: 'name',
      name: acc.name, homeDir: acc.homeDir,
      color: acc.color || 'cyan',
      editingId: acc.id, error: null,
    })
  }

  function commitAccountForm(): void {
    if (!accountForm) return
    const name = accountForm.name.trim()
    const homeDir = accountForm.homeDir.trim() || '~'
    const color = accountForm.color
    if (!name) {
      setAccountForm({ ...accountForm, error: 'Name required', field: 'name' })
      return
    }
    updateConfig(c => {
      if (accountForm.mode === 'add') {
        const id = generateAccountId(name, c.accounts)
        const account: Account = { id, name, homeDir, color }
        return {
          ...c,
          accounts: [...c.accounts, account],
          activeAccountId: c.accounts.length === 0 ? id : c.activeAccountId,
        }
      } else {
        return {
          ...c,
          accounts: c.accounts.map(a =>
            a.id === accountForm.editingId ? { ...a, name, homeDir, color } : a,
          ),
        }
      }
    })
    setAccountForm(null)
  }

  function cycleFormField(dir: 1 | -1): void {
    const order: FormField[] = ['name', 'homeDir', 'color']
    setAccountForm(f => {
      if (!f) return f
      const i = order.indexOf(f.field)
      const next = order[(i + dir + order.length) % order.length]
      return { ...f, field: next }
    })
  }

  function cycleColor(dir: 1 | -1): void {
    setAccountForm(f => {
      if (!f) return f
      const i = COLOR_PALETTE.indexOf(f.color as typeof COLOR_PALETTE[number])
      const idx = i < 0 ? 0 : i
      const next = COLOR_PALETTE[(idx + dir + COLOR_PALETTE.length) % COLOR_PALETTE.length]
      return { ...f, color: next }
    })
  }

  function deleteAccount(id: string): void {
    updateConfig(c => ({
      ...c,
      accounts: c.accounts.filter(a => a.id !== id),
      activeAccountId: c.activeAccountId === id ? null : c.activeAccountId,
    }))
  }

  // Settings rows = general (4) + accounts list + add row
  const accountRowsStart = GENERAL_ROWS
  const totalSettingsRows = GENERAL_ROWS + cfg.accounts.length + 1

  useInput((input, key) => {
    // Account form input handling
    if (showSettings && accountForm) {
      if (key.escape) { setAccountForm(null); return }
      if (key.tab) { cycleFormField(key.shift ? -1 : 1); return }
      if (key.upArrow) { cycleFormField(-1); return }
      if (key.downArrow) { cycleFormField(1); return }

      if (accountForm.field === 'color') {
        if (key.leftArrow) { cycleColor(-1); return }
        if (key.rightArrow) { cycleColor(1); return }
        if (key.return) { commitAccountForm(); return }
        // ignore typing on color field
        return
      }

      if (key.return) {
        if (accountForm.field === 'name') {
          setAccountForm(f => f && { ...f, field: 'homeDir' })
        } else if (accountForm.field === 'homeDir') {
          setAccountForm(f => f && { ...f, field: 'color' })
        }
        return
      }
      if (key.backspace || key.delete) {
        setAccountForm(f => {
          if (!f || f.field === 'color') return f
          const cur = f[f.field]
          return { ...f, [f.field]: cur.slice(0, -1), error: null }
        })
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setAccountForm(f => {
          if (!f || f.field === 'color') return f
          return { ...f, [f.field]: f[f.field] + input, error: null }
        })
        return
      }
      return
    }

    if (showSettings && tzEdit !== null) {
      if (key.escape) { setTzEdit(null); setTzError(null); return }
      if (key.return) {
        const val = tzEdit.trim()
        if (val === '' || val.toLowerCase() === 'system') {
          updateConfig(c => ({ ...c, timezone: null }))
          setTzEdit(null); setTzError(null)
        } else if (isValidTimezone(val)) {
          updateConfig(c => ({ ...c, timezone: val }))
          setTzEdit(null); setTzError(null)
        } else {
          setTzError(`Invalid: ${val}`)
        }
        return
      }
      if (key.backspace || key.delete) { setTzEdit(s => (s ?? '').slice(0, -1)); setTzError(null); return }
      if (input && !key.ctrl && !key.meta) { setTzEdit(s => (s ?? '') + input); setTzError(null); return }
      return
    }

    if (input === 'q') { exit(); return }

    if (showSettings) {
      if (key.escape || input === 's') { setShowSettings(false); return }
      if (key.upArrow) { setSettingsCursor(c => Math.max(0, c - 1)); return }
      if (key.downArrow) { setSettingsCursor(c => Math.min(totalSettingsRows - 1, c + 1)); return }

      // General settings
      if (settingsCursor === 0) {
        if (key.leftArrow) updateConfig(c => ({ ...c, interval: Math.max(1, c.interval - 1) }))
        if (key.rightArrow) updateConfig(c => ({ ...c, interval: c.interval + 1 }))
        return
      }
      if (settingsCursor === 1) {
        if (key.leftArrow) updateConfig(c => ({ ...c, billingInterval: Math.max(1, c.billingInterval - 1) }))
        if (key.rightArrow) updateConfig(c => ({ ...c, billingInterval: c.billingInterval + 1 }))
        return
      }
      if (settingsCursor === 2 && (key.leftArrow || key.rightArrow || key.return)) {
        updateConfig(c => ({ ...c, clearScreen: !c.clearScreen }))
        return
      }
      if (settingsCursor === 3) {
        if (key.return) { setTzEdit(cfg.timezone ?? ''); setTzError(null) }
        if (key.leftArrow || key.rightArrow) {
          updateConfig(c => ({ ...c, timezone: c.timezone === null ? systemTimezone() : null }))
        }
        return
      }

      // Account rows
      const accIdx = settingsCursor - accountRowsStart
      if (accIdx >= 0 && accIdx < cfg.accounts.length) {
        const acc = cfg.accounts[accIdx]
        if (key.return) { openEditAccount(acc); return }
        if (input === 'd' || input === 'x') { deleteAccount(acc.id); return }
        if (input === ' ') { updateConfig(c => ({ ...c, activeAccountId: acc.id })); return }
        return
      }
      // Add new account row
      if (accIdx === cfg.accounts.length && key.return) {
        openAddAccount()
        return
      }
      return
    }

    if (input === 's') { setShowSettings(true); setSettingsCursor(0); return }
    if (input === 'a') { cycleAccount(1); return }
    if (input === 'A') { cycleAccount(-1); return }
    if (key.tab) { setTab(t => (t + 1) % TABS.length); resetView(); return }
    // number-key direct jump: 0=All, 1..N=account by index
    if (input && /^[0-9]$/.test(input) && slots.length > 1) {
      const target = slots[parseInt(input, 10)]
      if (target) { updateConfig(c => ({ ...c, activeAccountId: target.id })); resetView() }
      return
    }

    if (tab === 1) {
      if (input === 'd') { setView(0); resetView(); return }
      if (input === 'w') { setView(1); resetView(); return }
      if (input === 'm') { setView(2); resetView(); return }
      if (key.leftArrow) { setView(v => (v - 1 + VIEWS.length) % VIEWS.length); resetView(); return }
      if (key.rightArrow) { setView(v => (v + 1) % VIEWS.length); resetView(); return }
      if (input === 'o') { setSort(s => (s + 1) % SORTS.length); resetView(); return }
      if (key.return) { setExpanded(e => e === cursor ? -1 : cursor); return }
      if (key.escape) { setExpanded(-1); return }
    } else {
      if (key.leftArrow || key.rightArrow) { setTab(t => (t + 1) % TABS.length); resetView(); return }
    }

    if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return }
    if (key.downArrow) { setCursor(c => c + 1); return }
    if (key.pageDown || input === 'G') { setCursor(c => input === 'G' ? 99999 : c + Math.max(1, rows - 12)); return }
    if (key.pageUp || input === 'g') { setCursor(c => input === 'g' ? 0 : Math.max(0, c - Math.max(1, rows - 12))); return }
  }, { isActive: IS_TTY })

  if (error) return <Box padding={1}><Text color="red">{error}</Text></Box>
  if (!config) return <Box padding={1}><Text dimColor>Loading...</Text></Box>

  const firstStats = stats.size > 0 ? [...stats.values()][0] : null
  if (!firstStats?.dashboard) return <Box padding={1}><Text dimColor>Loading...</Text></Box>

  const peakBilling = firstStats.billing
  const rawTableData = table ? [table.daily, table.weekly, table.monthly][view] : []
  const tableData = sortRows(rawTableData, sort)

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} height={rows}>
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="greenBright">{'◉'} tokmon</Text>
          <Text dimColor>  ·  every {cfg.interval}s</Text>
        </Box>
        <Box>
          {peakBilling?.peak && (
            <>
              <PeakBadge peak={peakBilling.peak} />
              <Text dimColor>  ·  </Text>
            </>
          )}
          <Text dimColor>{fmt.time(updated, tz)}</Text>
        </Box>
      </Box>

      {showSettings ? (
        <SettingsView
          config={cfg}
          cursor={settingsCursor}
          tzEdit={tzEdit}
          tzError={tzError}
          resolvedTz={tz}
          accountForm={accountForm}
          onSettingsClick={(i) => setSettingsCursor(i)}
          onAddAccount={openAddAccount}
          onEditAccount={openEditAccount}
          onActivateAccount={(id) => updateConfig(c => ({ ...c, activeAccountId: id }))}
          activeAccountId={cfg.activeAccountId}
        />
      ) : (
        <>
          {slots.length > 1 && (
            <Box marginTop={1}>
              <AccountStrip
                slots={slots}
                activeIdx={activeSlotIdx}
                onSelect={(i) => {
                  const id = slots[i].id
                  updateConfig(c => ({ ...c, activeAccountId: id }))
                  resetView()
                }}
              />
            </Box>
          )}
          <Box marginTop={slots.length > 1 ? 0 : 1}>
            <TabBar tabs={TABS} active={tab} onSelect={(i) => { setTab(i); resetView() }} />
            <Text dimColor>  Tab/←→</Text>
          </Box>
          <Box height={1} />
          {tab === 0 && (
            <DashboardView
              slots={visibleSlots}
              stats={stats}
              compact={visibleSlots.length > 1}
            />
          )}
          {tab === 1 && (
            <>
              <ViewBar views={VIEWS} active={view} sort={SORTS[sort]} onSelect={(i) => { setView(i); resetView() }} />
              <Box height={1} />
              {tableLoading && !table
                ? <Spinner label="Loading 6 months of history" />
                : <TableView rows={tableData} cursor={cursor} expanded={expanded} maxRows={rows - 14} cols={cols}
                    onRowClick={(idx) => {
                      if (idx === cursor) setExpanded(e => e === idx ? -1 : idx)
                      else setCursor(idx)
                    }}
                  />
              }
            </>
          )}
        </>
      )}

      {(tab === 0 || showSettings) && <Footer hasAccounts={slots.length > 1} />}
    </Box>
  )
}

function Footer({ hasAccounts }: { hasAccounts: boolean }) {
  return (
    <Box marginTop={1}>
      <Text dimColor>by </Text>
      <Text>David Ilie</Text>
      <Text dimColor> (</Text>
      <Text color="cyan">davidilie.com</Text>
      <Text dimColor>)  ·  s=settings  </Text>
      {hasAccounts && <Text dimColor>0-9=jump  a/A=cycle  </Text>}
      <Text dimColor>q=quit</Text>
    </Box>
  )
}

function TabBar({ tabs, active, onSelect }: { tabs: readonly string[]; active: number; onSelect: (i: number) => void }) {
  return (
    <Box>
      {tabs.map((t, i) => (
        <ClickableBox key={t} onClick={() => onSelect(i)} marginRight={1}>
          {i === active ? <Text bold inverse> {t} </Text> : <Text dimColor> {t} </Text>}
        </ClickableBox>
      ))}
    </Box>
  )
}

function AccountStrip({ slots, activeIdx, onSelect }: { slots: AccountSlot[]; activeIdx: number; onSelect: (i: number) => void }) {
  return (
    <Box flexWrap="wrap">
      {slots.map((s, i) => {
        const active = i === activeIdx
        const dot = s.id === null ? '✦' : '●'
        return (
          <ClickableBox key={s.id ?? '__all__'} onClick={() => onSelect(i)} marginRight={2}>
            <Text dimColor={!active}>{i}</Text>
            <Text>{' '}</Text>
            <Text color={s.color} bold={active} dimColor={!active}>{dot}</Text>
            <Text>{' '}</Text>
            {active ? (
              <Text bold color={s.color}>{s.name}</Text>
            ) : (
              <Text dimColor>{s.name}</Text>
            )}
          </ClickableBox>
        )
      })}
    </Box>
  )
}

function ViewBar({ views, active, sort, onSelect }: { views: readonly string[]; active: number; sort: string; onSelect: (i: number) => void }) {
  return (
    <Box>
      {views.map((v, i) => (
        <ClickableBox key={v} onClick={() => onSelect(i)} marginRight={2}>
          {i === active ? <Text bold color="cyan">[{v}]</Text> : <Text dimColor>{v}</Text>}
        </ClickableBox>
      ))}
      <Text dimColor>  sort: </Text>
      <Text bold color="magenta">{sort}</Text>
      <Text dimColor>  o=cycle</Text>
    </Box>
  )
}

function sortRows(rows: TableRow[], sortIdx: number): TableRow[] {
  if (rows.length === 0) return rows
  const sorted = [...rows]
  switch (sortIdx) {
    case 0: return sorted.sort((a, b) => a.label.localeCompare(b.label))
    case 1: return sorted.sort((a, b) => b.label.localeCompare(a.label))
    case 2: return sorted.sort((a, b) => a.cost - b.cost)
    case 3: return sorted.sort((a, b) => b.cost - a.cost)
    default: return sorted
  }
}

type FormField = 'name' | 'homeDir' | 'color'

interface AccountForm {
  mode: 'add' | 'edit'
  field: FormField
  name: string
  homeDir: string
  color: string
  editingId: string | null
  error: string | null
}

const COLOR_PALETTE = [
  'cyan', 'magenta', 'green', 'yellow', 'blue', 'red',
  'cyanBright', 'magentaBright', 'greenBright',
] as const

function SettingsView({
  config, cursor, tzEdit, tzError, resolvedTz, accountForm,
  onAddAccount, onEditAccount, onActivateAccount, activeAccountId,
}: {
  config: Config
  cursor: number
  tzEdit: string | null
  tzError: string | null
  resolvedTz: string
  accountForm: AccountForm | null
  onSettingsClick: (i: number) => void
  onAddAccount: () => void
  onEditAccount: (a: Account) => void
  onActivateAccount: (id: string) => void
  activeAccountId: string | null
}) {
  const editingTz = tzEdit !== null
  const tzDisplay = config.timezone === null ? `System (${resolvedTz})` : config.timezone
  const accountRowsStart = GENERAL_ROWS

  if (accountForm) {
    return <AccountFormView form={accountForm} accounts={config.accounts} />
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Settings</Text>
      <Text dimColor>{configLocation()}</Text>
      <Box height={1} />
      <Text bold dimColor>General</Text>
      <Box>
        <Text color={cursor === 0 ? 'green' : undefined}>{cursor === 0 ? '▸' : ' '} </Text>
        <Text>Refresh interval    </Text>
        <Text dimColor>{'◂'} </Text>
        <Text bold color="yellow">{config.interval}s</Text>
        <Text dimColor> {'▸'}</Text>
      </Box>
      <Box>
        <Text color={cursor === 1 ? 'green' : undefined}>{cursor === 1 ? '▸' : ' '} </Text>
        <Text>Billing poll        </Text>
        <Text dimColor>{'◂'} </Text>
        <Text bold color="yellow">{config.billingInterval}m</Text>
        <Text dimColor> {'▸'}</Text>
      </Box>
      <Box>
        <Text color={cursor === 2 ? 'green' : undefined}>{cursor === 2 ? '▸' : ' '} </Text>
        <Text>Clear screen        </Text>
        <Text bold color={config.clearScreen ? 'green' : 'red'}>{config.clearScreen ? 'on' : 'off'}</Text>
      </Box>
      <Box>
        <Text color={cursor === 3 ? 'green' : undefined}>{cursor === 3 ? '▸' : ' '} </Text>
        <Text>Timezone            </Text>
        {editingTz ? (
          <>
            <Text dimColor>[</Text>
            <Text bold color="cyan">{tzEdit}</Text>
            <Text color="cyan">_</Text>
            <Text dimColor>]</Text>
          </>
        ) : (
          <Text bold color="yellow">{tzDisplay}</Text>
        )}
      </Box>
      {cursor === 3 && tzError && <Text color="red">  {tzError}</Text>}

      <Box height={1} />
      <Text bold dimColor>Claude accounts</Text>
      {config.accounts.length === 0 && (
        <Text dimColor>  none — using default Claude HOME</Text>
      )}
      {config.accounts.map((acc, i) => {
        const idx = accountRowsStart + i
        const selected = cursor === idx
        const isActive = acc.id === activeAccountId
        return (
          <Box key={acc.id}>
            <Text color={selected ? 'green' : undefined}>{selected ? '▸' : ' '} </Text>
            <Text color={acc.color || 'cyan'}>{isActive ? '●' : '○'} </Text>
            <Box width={16}><Text bold>{acc.name}</Text></Box>
            <Box width={14}><Text dimColor>{acc.id}</Text></Box>
            <Text dimColor>{acc.homeDir}</Text>
          </Box>
        )
      })}
      <Box>
        <Text color={cursor === accountRowsStart + config.accounts.length ? 'green' : undefined}>
          {cursor === accountRowsStart + config.accounts.length ? '▸' : ' '}{' '}
        </Text>
        <Text color="greenBright">+ </Text>
        <Text>Add account</Text>
      </Box>

      <Box height={1} />
      {editingTz ? (
        <Text dimColor>type IANA name (e.g. Europe/London) · empty = System · Enter save · Esc cancel</Text>
      ) : cursor >= accountRowsStart && cursor < accountRowsStart + config.accounts.length ? (
        <Text dimColor>↑↓ select  ·  Enter edit  ·  space activate  ·  d delete  ·  s/Esc close</Text>
      ) : cursor === accountRowsStart + config.accounts.length ? (
        <Text dimColor>↑↓ select  ·  Enter add account  ·  s/Esc close</Text>
      ) : (
        <Text dimColor>↑↓ select  ←→ adjust  Enter edit  s/Esc close</Text>
      )}
    </Box>
  )
}

function AccountFormView({ form, accounts }: { form: AccountForm; accounts: Account[] }) {
  const previewId = form.mode === 'add'
    ? generateAccountId(form.name || 'account', accounts)
    : form.editingId ?? ''
  const accent = form.color
  const stepIndex: Record<FormField, number> = { name: 1, homeDir: 2, color: 3 }
  const step = stepIndex[form.field]

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={accent} bold>▍</Text>
        <Text bold>{' '}{form.mode === 'add' ? 'NEW ACCOUNT' : 'EDIT ACCOUNT'}</Text>
        <Text dimColor>   step {step} of 3</Text>
      </Box>
      <Box marginTop={1}>
        <Stepper active={form.field} accent={accent} />
      </Box>

      <Box marginTop={1}
        flexDirection="column"
        borderStyle="round"
        borderColor={accent}
        paddingX={2}
        paddingY={1}
      >
        <FormField
          label="Name"
          hint="display name for this Claude account"
          value={form.name}
          focused={form.field === 'name'}
          accent={accent}
          placeholder="e.g. Work, Personal"
        />
        <Box height={1} />
        <FormField
          label="Home directory"
          hint="path containing .claude/  ·  ~ for default"
          value={form.homeDir}
          focused={form.field === 'homeDir'}
          accent={accent}
          placeholder="~/claude-work"
          mono
        />
        <Box height={1} />
        <ColorField
          value={form.color}
          focused={form.field === 'color'}
        />
        <Box height={1} />
        <Box>
          <Text dimColor>id  </Text>
          <Text dimColor>┤ </Text>
          <Text bold color={accent}>{previewId || 'account'}</Text>
          <Text dimColor> ├</Text>
          <Text dimColor>   auto-generated from name</Text>
        </Box>
      </Box>

      {form.error && (
        <Box marginTop={1}>
          <Text color="red">⚠ {form.error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>tab/↑↓ </Text>
        <Text>switch field</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>enter </Text>
        <Text>{form.field === 'color' ? 'save' : 'next'}</Text>
        <Text dimColor>  ·  </Text>
        {form.field === 'color' && (
          <>
            <Text dimColor>←→ </Text>
            <Text>pick color</Text>
            <Text dimColor>  ·  </Text>
          </>
        )}
        <Text dimColor>esc </Text>
        <Text>cancel</Text>
      </Box>
    </Box>
  )
}

function Stepper({ active, accent }: { active: FormField; accent: string }) {
  const steps: { id: FormField; label: string }[] = [
    { id: 'name', label: 'Name' },
    { id: 'homeDir', label: 'Home' },
    { id: 'color', label: 'Color' },
  ]
  const order = steps.map(s => s.id)
  const activeIdx = order.indexOf(active)
  return (
    <Box>
      {steps.map((s, i) => {
        const done = i < activeIdx
        const cur = i === activeIdx
        const dot = done ? '●' : cur ? '◉' : '○'
        return (
          <Box key={s.id}>
            <Text color={cur ? accent : done ? accent : undefined} dimColor={!cur && !done}>{dot} </Text>
            <Text bold={cur} color={cur ? accent : undefined} dimColor={!cur}>{s.label}</Text>
            {i < steps.length - 1 && <Text dimColor>  ─  </Text>}
          </Box>
        )
      })}
    </Box>
  )
}

function FormField({
  label, hint, value, focused, accent, placeholder, mono,
}: {
  label: string
  hint: string
  value: string
  focused: boolean
  accent: string
  placeholder: string
  mono?: boolean
}) {
  const display = value === '' ? placeholder : value
  const isPlaceholder = value === ''
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? accent : undefined} bold={focused} dimColor={!focused}>
          {focused ? '▸' : ' '} {label}
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text color={focused ? accent : undefined}>  {focused ? '▌' : ' '} </Text>
        <Text
          bold={focused && !isPlaceholder}
          color={focused && !isPlaceholder ? accent : undefined}
          dimColor={isPlaceholder}
          italic={mono && isPlaceholder}
        >
          {display}
        </Text>
        {focused && <Text color={accent}>▏</Text>}
      </Box>
      <Box>
        <Text dimColor>      {hint}</Text>
      </Box>
    </Box>
  )
}

function ColorField({ value, focused }: { value: string; focused: boolean }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focused ? value : undefined} bold={focused} dimColor={!focused}>
          {focused ? '▸' : ' '} Accent color
        </Text>
      </Box>
      <Box marginTop={0}>
        <Text>  {focused ? '▌' : ' '} </Text>
        {COLOR_PALETTE.map((c, i) => {
          const selected = c === value
          return (
            <Box key={c} marginRight={1}>
              {selected ? (
                <Text bold color={c}>[●]</Text>
              ) : (
                <Text color={c} dimColor={!focused}>{i === COLOR_PALETTE.length - 1 ? ' ●' : ' ●'}</Text>
              )}
            </Box>
          )
        })}
      </Box>
      <Box>
        <Text dimColor>      shows on dashboard, account strip, borders</Text>
      </Box>
    </Box>
  )
}

function DashboardView({ slots, stats, compact }: { slots: AccountSlot[]; stats: Map<string, AccountStats>; compact: boolean }) {
  const slotKey = (s: AccountSlot) => s.id ?? '__default__'
  if (compact) {
    const accountStats = slots
      .map(slot => ({ slot, s: stats.get(slotKey(slot)) }))
      .filter((x): x is { slot: AccountSlot; s: AccountStats } => !!x.s?.dashboard)
    return <ComparisonView accountStats={accountStats} />
  }
  const slot = slots[0]
  const s = stats.get(slotKey(slot))
  if (!s?.dashboard) {
    return (
      <Box>
        <Text color={slot.color} bold>● {slot.name} </Text>
        <Text dimColor>loading...</Text>
      </Box>
    )
  }
  return <SoloAccountCard slot={slot} dashboard={s.dashboard} billing={s.billing} />
}

function bar(value: number, max: number, width: number): { filled: number; empty: number } {
  if (max <= 0) return { filled: 0, empty: width }
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)))
  return { filled, empty: width - filled }
}

function SoloAccountCard({ slot, dashboard, billing }: { slot: AccountSlot; dashboard: DashboardData; billing: BillingData | null }) {
  const maxCost = Math.max(dashboard.today.cost, dashboard.week.cost, dashboard.month.cost, 0.01)
  const maxTokens = Math.max(dashboard.today.tokens, dashboard.week.tokens, dashboard.month.tokens, 1)
  const rows = [
    { label: 'Today', s: dashboard.today },
    { label: 'This Week', s: dashboard.week },
    { label: 'This Month', s: dashboard.month },
  ]
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={slot.color} bold>● {slot.name}</Text>
        {slot.id && <Text dimColor>   {slot.id}</Text>}
      </Box>

      <Box
        flexDirection="column"
        marginTop={1}
        paddingLeft={1}
        borderStyle="bold"
        borderColor={slot.color}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
      >
        <Text bold>Usage</Text>
        <Box height={1} />
        {rows.map(r => (
          <DualBarRow key={r.label} label={r.label} cost={r.s.cost} tokens={r.s.tokens} maxCost={maxCost} maxTokens={maxTokens} color={slot.color} />
        ))}
        {dashboard.burnRate > 0 && (
          <>
            <Box height={1} />
            <Box>
              <Box width={14}><Text dimColor>Burn rate</Text></Box>
              <Box width={12} justifyContent="flex-end"><Text color="red">{fmt.currency(dashboard.burnRate)}</Text></Box>
              <Text dimColor>/hr</Text>
            </Box>
          </>
        )}
      </Box>

      <Box height={1} />
      <Box
        flexDirection="column"
        paddingLeft={1}
        borderStyle="bold"
        borderColor={billing?.error ? 'red' : 'yellow'}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
      >
        <Text bold>Rate Limits</Text>
        <Box height={1} />
        {billing?.error ? (
          <Text color="red">{billing.error}</Text>
        ) : billing?.session || billing?.weekly ? (
          <>
            {billing.session && <LimitBar label="Session" pct={billing.session.utilization} resets={billing.session.resetsAt} />}
            {billing.weekly && <LimitBar label="Weekly" pct={billing.weekly.utilization} resets={billing.weekly.resetsAt} />}
            {billing.sonnet && <LimitBar label="Sonnet" pct={billing.sonnet.utilization} resets={billing.sonnet.resetsAt} />}
            {billing.extraUsage && (
              <Box>
                <Box width={10}><Text dimColor>Extra</Text></Box>
                <Text color="yellow">${billing.extraUsage.used.toFixed(2)}</Text>
                <Text dimColor> / ${billing.extraUsage.limit.toFixed(2)} limit</Text>
              </Box>
            )}
          </>
        ) : (
          <Text dimColor>Fetching...</Text>
        )}
      </Box>
    </Box>
  )
}

function DualBarRow({
  label, cost, tokens, maxCost, maxTokens, color,
}: {
  label: string
  cost: number
  tokens: number
  maxCost: number
  maxTokens: number
  color: string
}) {
  const W = 18
  const c = bar(cost, maxCost, W)
  const t = bar(tokens, maxTokens, W)
  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Box width={12}><Text dimColor>{label}</Text></Box>
        <Text color={color}>{'█'.repeat(c.filled)}</Text>
        <Text dimColor>{'░'.repeat(c.empty)}</Text>
        <Text>  </Text>
        <Box width={11} justifyContent="flex-end">
          <Text bold color="yellow">{fmt.currency(cost)}</Text>
        </Box>
      </Box>
      <Box>
        <Box width={12}><Text> </Text></Box>
        <Text color={color} dimColor>{'▓'.repeat(t.filled)}</Text>
        <Text dimColor>{'░'.repeat(t.empty)}</Text>
        <Text>  </Text>
        <Box width={11} justifyContent="flex-end">
          <Text dimColor>{fmt.tokens(tokens)} tk</Text>
        </Box>
      </Box>
    </Box>
  )
}

function ComparisonView({ accountStats }: { accountStats: { slot: AccountSlot; s: AccountStats }[] }) {
  if (accountStats.length === 0) {
    return <Text dimColor>No accounts loaded yet...</Text>
  }
  const periods = [
    { key: 'Today', pick: (d: DashboardData) => d.today },
    { key: 'This Week', pick: (d: DashboardData) => d.week },
    { key: 'This Month', pick: (d: DashboardData) => d.month },
  ] as const

  return (
    <Box flexDirection="column">
      {periods.map((p, i) => {
        const rows = accountStats.map(({ slot, s }) => ({
          slot,
          summary: p.pick(s.dashboard!),
        }))
        const maxCost = Math.max(0.01, ...rows.map(r => r.summary.cost))
        const maxTokens = Math.max(1, ...rows.map(r => r.summary.tokens))
        return (
          <Box key={p.key} flexDirection="column" marginBottom={i < periods.length - 1 ? 1 : 0}>
            <Box>
              <Text bold dimColor>{p.key.toUpperCase()}</Text>
            </Box>
            {rows.map(({ slot, summary }) => (
              <ComparisonRow
                key={slot.id ?? '__default__'}
                slot={slot}
                cost={summary.cost}
                tokens={summary.tokens}
                maxCost={maxCost}
                maxTokens={maxTokens}
              />
            ))}
          </Box>
        )
      })}

      <Box height={1} />
      <Box flexDirection="column">
        <Text bold dimColor>RATE LIMITS</Text>
        {accountStats.map(({ slot, s }) => (
          <CompactLimitsRow key={slot.id ?? '__default__'} slot={slot} billing={s.billing} />
        ))}
      </Box>
    </Box>
  )
}

function ComparisonRow({
  slot, cost, tokens, maxCost, maxTokens,
}: {
  slot: AccountSlot
  cost: number
  tokens: number
  maxCost: number
  maxTokens: number
}) {
  const W = 22
  const c = bar(cost, maxCost, W)
  const t = bar(tokens, maxTokens, W)
  return (
    <Box>
      <Box width={14}>
        <Text color={slot.color}>● </Text>
        <Text dimColor>{slot.name}</Text>
      </Box>
      <Text color={slot.color}>{'█'.repeat(c.filled)}</Text>
      <Text dimColor>{'░'.repeat(c.empty)}</Text>
      <Text>  </Text>
      <Box width={10} justifyContent="flex-end"><Text bold color="yellow">{fmt.currency(cost)}</Text></Box>
      <Text>  </Text>
      <Text color={slot.color} dimColor>{'▓'.repeat(t.filled)}</Text>
      <Text dimColor>{'░'.repeat(t.empty)}</Text>
      <Text>  </Text>
      <Box width={10} justifyContent="flex-end"><Text dimColor>{fmt.tokens(tokens)} tk</Text></Box>
    </Box>
  )
}

function CompactLimitsRow({ slot, billing }: { slot: AccountSlot; billing: BillingData | null }) {
  if (billing?.error) {
    return (
      <Box>
        <Box width={14}>
          <Text color={slot.color}>● </Text>
          <Text dimColor>{slot.name}</Text>
        </Box>
        <Text color="red">{billing.error}</Text>
      </Box>
    )
  }
  const fmtPct = (p?: { utilization: number } | null) =>
    p ? `${Math.round(p.utilization)}%` : '—'
  const colorFor = (p?: { utilization: number } | null) => {
    if (!p) return undefined
    return p.utilization >= 80 ? 'red' : p.utilization >= 50 ? 'yellow' : 'green'
  }
  return (
    <Box>
      <Box width={14}>
        <Text color={slot.color}>● </Text>
        <Text dimColor>{slot.name}</Text>
      </Box>
      <Text dimColor>S </Text>
      <Box width={6}><Text bold color={colorFor(billing?.session)}>{fmtPct(billing?.session)}</Text></Box>
      <Text dimColor>W </Text>
      <Box width={6}><Text bold color={colorFor(billing?.weekly)}>{fmtPct(billing?.weekly)}</Text></Box>
      <Text dimColor>Sonnet </Text>
      <Box width={6}><Text bold color={colorFor(billing?.sonnet)}>{fmtPct(billing?.sonnet)}</Text></Box>
    </Box>
  )
}

function PeakBadge({ peak }: { peak: PeakStatus }) {
  const color = peak.state === 'peak' ? 'red' : 'green'
  return (
    <Box>
      <Text color={color}>● </Text>
      <Text bold color={color}>{peak.label}</Text>
      {peak.minutesUntilChange !== null && peak.minutesUntilChange > 0 && (
        <Text dimColor> ({fmtMinutes(peak.minutesUntilChange)})</Text>
      )}
    </Box>
  )
}

function fmtMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function LimitBar({ label, pct, resets }: { label: string; pct: number; resets: string }) {
  const width = 30
  const filled = Math.round((pct / 100) * width)
  const color = pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green'
  return (
    <Box>
      <Box width={10}><Text dimColor>{label}</Text></Box>
      <Text color={color}>{'━'.repeat(filled)}</Text>
      <Text dimColor>{'─'.repeat(width - filled)}</Text>
      <Text> </Text>
      <Text bold>{Math.round(pct)}%</Text>
      <Text dimColor>  resets {resets}</Text>
    </Box>
  )
}

function TableView({ rows: allRows, cursor, expanded, maxRows, cols, onRowClick }: { rows: TableRow[]; cursor: number; expanded: number; maxRows: number; cols: number; onRowClick: (idx: number) => void }) {
  const wide = cols > 90
  const base = wide
    ? { label: 12, input: 10, output: 10, cc: 14, cr: 12, total: 11, cost: 13 }
    : { label: 8, input: 7, output: 7, cc: 7, cr: 8, total: 0, cost: 11 }
  const fixed = base.label + base.input + base.output + base.cc + base.cr + base.total + base.cost
  const minModels = wide ? 22 : 14
  const available = cols - fixed - 6
  const W = { ...base, models: Math.max(minModels, available) }
  const lineW = W.label + W.models + W.input + W.output + W.cc + W.cr + W.total + W.cost

  const totals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0 }
  for (const r of allRows) {
    totals.input += r.input; totals.output += r.output
    totals.cacheCreate += r.cacheCreate; totals.cacheRead += r.cacheRead; totals.cost += r.cost
  }

  const clampedCursor = Math.min(cursor, allRows.length - 1)
  const scrollStart = Math.max(0, Math.min(clampedCursor - Math.floor(maxRows / 2), allRows.length - maxRows))
  const visible = allRows.slice(scrollStart, scrollStart + maxRows)

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>  {fmt.col('Date', W.label, 'left')}</Text>
        <Text bold>{fmt.col('Models', W.models, 'left')}</Text>
        <Text bold>{fmt.col('Input', W.input)}</Text>
        <Text bold>{fmt.col('Output', W.output)}</Text>
        <Text bold>{fmt.col(wide ? 'Cache Create' : 'CchCrt', W.cc)}</Text>
        <Text bold>{fmt.col(wide ? 'Cache Read' : 'CchRd', W.cr)}</Text>
        {W.total > 0 && <Text bold>{fmt.col('Total', W.total)}</Text>}
        <Text bold>{fmt.col('Cost', W.cost)}</Text>
      </Text>
      <Text dimColor>{'─'.repeat(lineW + 2)}</Text>
      {visible.map((r, vi) => {
        const idx = scrollStart + vi
        const selected = idx === clampedCursor
        const isExpanded = idx === expanded
        return (
          <Box key={r.label} flexDirection="column">
            <ClickableBox onClick={() => onRowClick(idx)}>
              <Text inverse={selected}>
                <Text color={selected ? undefined : 'cyan'}>{selected ? '▸ ' : '  '}{fmt.col(fmtLabel(r.label), W.label, 'left')}</Text>
                <Text dimColor={!selected}>{fmt.col(r.models.join(', '), W.models, 'left')}</Text>
                <Text>{fmt.col(fmt.tokens(r.input), W.input)}</Text>
                <Text>{fmt.col(fmt.tokens(r.output), W.output)}</Text>
                <Text>{fmt.col(fmt.tokens(r.cacheCreate), W.cc)}</Text>
                <Text>{fmt.col(fmt.tokens(r.cacheRead), W.cr)}</Text>
                {W.total > 0 && <Text>{fmt.col(fmt.tokens(r.total), W.total)}</Text>}
                <Text bold color={selected ? undefined : 'yellow'}>{fmt.col(fmt.currency(r.cost), W.cost)}</Text>
              </Text>
            </ClickableBox>
            {isExpanded && <RowDetail row={r} indent={W.label + 2} />}
          </Box>
        )
      })}
      <Text dimColor>{'─'.repeat(lineW + 2)}</Text>
      <Text>
        <Text bold color="greenBright">  {fmt.col('Total', W.label, 'left')}</Text>
        <Text>{fmt.col('', W.models, 'left')}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.input), W.input)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.output), W.output)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.cacheCreate), W.cc)}</Text>
        <Text bold color="yellow">{fmt.col(fmt.tokens(totals.cacheRead), W.cr)}</Text>
        {W.total > 0 && <Text bold color="yellow">{fmt.col(fmt.tokens(totals.input + totals.output + totals.cacheCreate + totals.cacheRead), W.total)}</Text>}
        <Text bold color="yellowBright">{fmt.col(fmt.currency(totals.cost), W.cost)}</Text>
      </Text>
      <Box height={1} />
      <Text dimColor>↑↓ navigate  ·  Enter detail  ·  o sort  ·  g/G top/bottom  ·  {clampedCursor + 1}/{allRows.length}</Text>
      <Box height={1} />
      <Footer hasAccounts={false} />
    </Box>
  )
}

function RowDetail({ row, indent }: { row: TableRow; indent: number }) {
  return (
    <Box flexDirection="column" paddingLeft={indent} marginY={0}>
      {row.breakdown.map((m, i) => {
        const prefix = i === row.breakdown.length - 1 ? '└─' : '├─'
        return (
          <Text key={m.name}>
            <Text dimColor>{prefix} </Text>
            <Text bold>{fmt.col(m.name, 16, 'left')}</Text>
            <Text>{fmt.col(fmt.tokens(m.input), 8)} in  </Text>
            <Text>{fmt.col(fmt.tokens(m.output), 8)} out  </Text>
            <Text>{fmt.col(fmt.tokens(m.cacheCreate), 8)} cc  </Text>
            <Text>{fmt.col(fmt.tokens(m.cacheRead), 9)} cr  </Text>
            <Text bold color="yellow">{fmt.currency(m.cost)}</Text>
          </Text>
        )
      })}
    </Box>
  )
}

function Spinner({ label }: { label: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI(n => (n + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(id)
  }, [])
  return (
    <Box>
      <Text color="green">{SPINNER_FRAMES[i]} </Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}

function fmtLabel(label: string): string {
  if (label.length === 10 && label[4] === '-') return fmt.shortDate(label)
  if (label.length === 7 && label[4] === '-') {
    const m = label.slice(5, 7)
    return `${MONTHS[Number(m)]} '${label.slice(2, 4)}`
  }
  return fmt.shortDate(label)
}

function ClickableBox({ onClick, children, ...props }: { onClick: () => void; children: React.ReactNode } & Record<string, unknown>) {
  const ref = useRef<DOMElement>(null)
  useOnMouseClick(ref, (clicked) => { if (clicked) onClick() })
  return <Box ref={ref} {...props}>{children}</Box>
}
