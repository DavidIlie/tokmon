import type { Provider } from '../types'
import { detectCursor, cursorBilling } from './billing'
import { cursorUsageTable } from './composer'

export const cursorProvider: Provider = {
  id: 'cursor',
  name: 'Cursor',
  color: 'magenta',
  // hasUsage stays false: the TUI keys its dedicated Cursor spend-table off this flag.
  // The web surfaces the local composer usage table via fetchTable (resolveAccounts
  // promotes any provider with a fetchTable to hasUsage for the dashboard only).
  hasUsage: false,
  hasBilling: true,
  detect: (homeDir) => detectCursor(homeDir),
  fetchTable: (account, tz) => cursorUsageTable(tz, account.homeDir).then(t => t ?? { daily: [], weekly: [], monthly: [] }),
  fetchBilling: (account) => cursorBilling(account),
}
