import type { Provider } from '../types'
import { detectGemini, geminiBilling } from './billing'

export const geminiProvider: Provider = {
  id: 'gemini',
  name: 'Gemini',
  color: 'greenBright',
  hasUsage: false,
  hasBilling: true,
  detect: (homeDir) => detectGemini(homeDir),
  fetchBilling: (account) => geminiBilling(account),
}
