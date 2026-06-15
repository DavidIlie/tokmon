import type { Provider } from '../types'
import { detectCursor, cursorBilling } from './billing'

export const cursorProvider: Provider = {
  id: 'cursor',
  name: 'Cursor',
  color: 'magenta',
  hasUsage: false,   // Cursor exposes spend/limits, not a token history
  hasBilling: true,
  detect: (homeDir) => detectCursor(homeDir),
  fetchBilling: (account) => cursorBilling(account),
}
