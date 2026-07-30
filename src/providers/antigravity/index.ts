import { PROVIDER_META } from '../../config-schema'
import type { Provider } from '../types'
import { antigravityBilling, detectAntigravity } from './billing'

export const antigravityProvider: Provider = {
  id: 'antigravity',
  ...PROVIDER_META.antigravity,
  hasUsage: false,
  hasBilling: true,
  detect: (homeDir) => detectAntigravity(homeDir),
  fetchBilling: (account) => antigravityBilling(account),
}
