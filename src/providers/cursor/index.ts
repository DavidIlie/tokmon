import type { Provider } from '../types'
import type { TableData } from '../../types'
import { detectCursor, cursorBilling } from './billing'
import { cursorUsageTable } from './composer'
import { cursorApiUsage } from './usage'

const EMPTY: TableData = { daily: [], weekly: [], monthly: [] }

// Prefer the dashboard API (authoritative, current, has composer-2.5 + token counts);
// fall back to the local composerData table when the token is missing/offline.
async function cursorTable(tz: string, homeDir?: string): Promise<TableData> {
  return (await cursorApiUsage(tz, homeDir)) ?? (await cursorUsageTable(tz, homeDir)) ?? EMPTY
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
