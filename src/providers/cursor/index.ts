import { PROVIDER_META } from '../../config-schema'
import type { Provider } from '../types'
import { detectCursor, cursorBilling } from './billing'
import { cursorDashboard, cursorTableFull } from './usage'

export const cursorProvider: Provider = {
  id: 'cursor',
  ...PROVIDER_META.cursor,
  hasUsage: true,
  hasBilling: true,
  detect: (homeDir) => detectCursor(homeDir),
  fetchSummary: (account, tz) => cursorDashboard(tz, account.homeDir),
  fetchTable: (account, tz) => cursorTableFull(tz, account.homeDir),
  fetchBilling: (account, tz) => cursorBilling(account, tz),
}
