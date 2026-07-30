import { PROVIDER_IDS, type ProviderId } from './providers/types'

export const PROVIDER_ORDER: ProviderId[] = [...PROVIDER_IDS]

export const PROVIDER_META: Record<ProviderId, { name: string; color: string }> = {
  claude: { name: 'Claude', color: 'green' },
  codex: { name: 'Codex', color: 'cyan' },
  cursor: { name: 'Cursor', color: 'magenta' },
  copilot: { name: 'Copilot', color: 'white' },
  pi: { name: 'Pi', color: 'blue' },
  opencode: { name: 'opencode', color: 'yellow' },
  antigravity: { name: 'Antigravity', color: 'red' },
  gemini: { name: 'Gemini', color: 'greenBright' },
  grok: { name: 'Grok', color: 'yellowBright' },
}
