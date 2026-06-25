import { PROVIDER_IDS, type Provider, type ProviderId } from './types'
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

export const PROVIDER_ORDER: ProviderId[] = [...PROVIDER_IDS]

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
