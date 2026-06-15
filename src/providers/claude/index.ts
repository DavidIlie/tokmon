import type { Provider } from '../types'
import { detectClaude, claudeDashboard, claudeTable } from './usage'
import { claudeBilling } from './billing'

export const claudeProvider: Provider = {
  id: 'claude',
  name: 'Claude',
  color: 'green',
  hasUsage: true,
  hasBilling: true,
  detect: (homeDir) => detectClaude(homeDir),
  fetchSummary: (account, tz) => claudeDashboard(tz, account.homeDir),
  fetchTable: (account, tz) => claudeTable(tz, account.homeDir),
  fetchBilling: (account) => claudeBilling(account),
}
