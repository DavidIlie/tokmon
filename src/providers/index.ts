import type { Provider, ProviderId } from './types'
import { claudeProvider } from './claude'
import { codexProvider } from './codex'
import { cursorProvider } from './cursor'
import { piProvider } from './pi'
import { opencodeProvider } from './opencode'
import { copilotProvider } from './copilot'
import { antigravityProvider } from './antigravity'
import { geminiProvider } from './gemini'
import { installSignals } from './detect'

export * from './types'
export { installSignals } from './detect'

export const PROVIDER_ORDER: ProviderId[] = ['claude', 'codex', 'cursor', 'copilot', 'pi', 'opencode', 'antigravity', 'gemini']

export const PROVIDERS: Record<ProviderId, Provider> = {
  claude: claudeProvider,
  codex: codexProvider,
  cursor: cursorProvider,
  pi: piProvider,
  opencode: opencodeProvider,
  copilot: copilotProvider,
  antigravity: antigravityProvider,
  gemini: geminiProvider,
}

export function getProvider(id: ProviderId): Provider {
  return PROVIDERS[id]
}

export const ALL_PROVIDERS: Provider[] = PROVIDER_ORDER.map(id => PROVIDERS[id])

/** Provider ids that look present — tool installed (PATH/app) or local data exists. */
export async function detectProviders(): Promise<ProviderId[]> {
  const found = await Promise.all(
    PROVIDER_ORDER.map(async id => {
      try {
        if (installSignals(id)) return id
        return (await PROVIDERS[id].detect()) ? id : null
      } catch {
        return null
      }
    }),
  )
  return found.filter((id): id is ProviderId => id !== null)
}
