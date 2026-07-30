import { PROVIDER_META } from '../../config-schema'
import type { Provider } from '../types'
import { grokBilling } from './billing'
import { detectGrok, grokDashboard, grokTable } from './usage'

export const grokProvider: Provider = {
  id: 'grok',
  ...PROVIDER_META.grok,
  hasUsage: true,
  hasBilling: true,
  detect: (homeDir) => detectGrok(homeDir),
  fetchSummary: (account, tz) => grokDashboard(tz, account.homeDir),
  fetchTable: (account, tz) => grokTable(tz, account.homeDir),
  fetchBilling: (account) => grokBilling(account),
}
