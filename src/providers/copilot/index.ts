import type { Provider } from '../types'
import { copilotBilling, detectCopilot } from './billing'

export const copilotProvider: Provider = {
  id: 'copilot',
  name: 'Copilot',
  color: 'white',
  hasUsage: false,
  hasBilling: true,
  detect: (homeDir) => detectCopilot(homeDir),
  fetchBilling: (account) => copilotBilling(account),
}
