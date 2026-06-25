import type { Provider } from '../types'
import { detectGemini, geminiBilling } from './billing'
import { geminiDashboard, geminiTable } from './usage'

export const geminiProvider: Provider = {
  id: 'gemini',
  name: 'Gemini',
  color: 'greenBright',
  hasUsage: true,
  hasBilling: true,
  detect: (homeDir) => detectGemini(homeDir),
  fetchSummary: (account, tz) => geminiDashboard(tz, account.homeDir),
  fetchTable: (account, tz) => geminiTable(tz, account.homeDir),
  fetchBilling: (account) => geminiBilling(account),
}
