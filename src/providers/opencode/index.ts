import type { Provider } from '../types'
import { detectOpencode, opencodeDashboard, opencodeTable } from './usage'

export const opencodeProvider: Provider = {
  id: 'opencode',
  name: 'opencode',
  color: 'yellow',
  hasUsage: true,
  hasBilling: false,
  detect: (homeDir) => detectOpencode(homeDir),
  fetchSummary: (account, tz) => opencodeDashboard(tz, account.homeDir),
  fetchTable: (account, tz) => opencodeTable(tz, account.homeDir),
}
