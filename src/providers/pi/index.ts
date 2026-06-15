import type { Provider } from '../types'
import { detectPi, piDashboard, piTable } from './usage'

export const piProvider: Provider = {
  id: 'pi',
  name: 'Pi',
  color: 'blue',
  hasUsage: true,
  hasBilling: false,
  detect: (homeDir) => detectPi(homeDir),
  fetchSummary: (account, tz) => piDashboard(tz, account.homeDir),
  fetchTable: (account, tz) => piTable(tz, account.homeDir),
}
