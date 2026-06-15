import type { Provider } from '../types'
import { antigravityBilling, detectAntigravity } from './billing'

export const antigravityProvider: Provider = {
  id: 'antigravity',
  name: 'Antigravity',
  color: 'red',
  hasUsage: false,
  hasBilling: true,
  detect: (homeDir) => detectAntigravity(homeDir),
  fetchBilling: (account) => antigravityBilling(account),
}
