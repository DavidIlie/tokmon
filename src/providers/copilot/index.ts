import { PROVIDER_META } from '../../config-schema'
import type { Provider } from '../types'
import { copilotBilling, detectCopilot } from './billing'

export const copilotProvider: Provider = {
  id: 'copilot',
  ...PROVIDER_META.copilot,
  hasUsage: false,
  hasBilling: true,
  detect: (homeDir) => detectCopilot(homeDir),
  fetchBilling: (account) => copilotBilling(account),
}
