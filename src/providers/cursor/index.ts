import type { Provider } from '../types'
import type { TableData, TableRow } from '../../types'
import { detectCursor, cursorBilling } from './billing'
import { cursorUsageTable } from './composer'
import { cursorApiUsage } from './usage'

const EMPTY: TableData = { daily: [], weekly: [], monthly: [] }

// The local composerData supplies full history; the dashboard API supplies the recent
// window (~90d) with token counts + composer-2.5. Overlay the API onto the local table
// per label so recent days are the richer API source and older days remain present —
// no double-counting (overlay replaces a label, never sums).
const overlay = (lo: TableRow[], hi: TableRow[]): TableRow[] => {
  const m = new Map(lo.map(r => [r.label, r]))
  for (const r of hi) m.set(r.label, r)
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label))
}

async function cursorTable(tz: string, homeDir?: string): Promise<TableData> {
  const [api, local] = await Promise.all([cursorApiUsage(tz, homeDir), cursorUsageTable(tz, homeDir)])
  if (!api) return local ?? EMPTY
  if (!local) return api
  return {
    daily: overlay(local.daily, api.daily),
    weekly: overlay(local.weekly, api.weekly),
    monthly: overlay(local.monthly, api.monthly),
  }
}

export const cursorProvider: Provider = {
  id: 'cursor',
  name: 'Cursor',
  color: 'magenta',
  // hasUsage stays false: the TUI keys its dedicated Cursor spend-table off this flag.
  // The web surfaces the usage table via fetchTable (resolveAccounts promotes any
  // provider with a fetchTable to hasUsage for the dashboard only).
  hasUsage: false,
  hasBilling: true,
  detect: (homeDir) => detectCursor(homeDir),
  fetchTable: (account, tz) => cursorTable(tz, account.homeDir),
  fetchBilling: (account) => cursorBilling(account),
}
