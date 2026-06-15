import type { Provider } from '../types'
import { detectCodex, codexDashboard, codexTable } from './usage'
import { codexBilling } from './billing'

export const codexProvider: Provider = {
  id: 'codex',
  name: 'Codex',
  color: 'cyan',
  hasUsage: true,
  hasBilling: true,
  detect: (homeDir) => detectCodex(homeDir),
  fetchSummary: (account, tz) => codexDashboard(tz, account.homeDir),
  fetchTable: (account, tz) => codexTable(tz, account.homeDir),
  fetchBilling: (account) => codexBilling(account),
}
