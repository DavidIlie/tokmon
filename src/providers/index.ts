import { PROVIDER_IDS, type Provider, type ProviderId } from './types'
import { claudeProvider } from './claude'
import { codexProvider } from './codex'
import { cursorProvider } from './cursor'
import { piProvider } from './pi'
import { opencodeProvider } from './opencode'
import { copilotProvider } from './copilot'
import { antigravityProvider } from './antigravity'
import { geminiProvider } from './gemini'
import { grokProvider } from './grok'
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
  grok: grokProvider,
}

async function detectWhere(predicate: (id: ProviderId) => Promise<boolean>): Promise<ProviderId[]> {
  const found = await Promise.all(
    PROVIDER_ORDER.map(async id => {
      try {
        return (await predicate(id)) ? id : null
      } catch {
        return null
      }
    }),
  )
  return found.filter((id): id is ProviderId => id !== null)
}

/**
 * Harness availability is an onboarding signal, not account evidence.
 * An installed but signed-out CLI must never synthesize a "No data" account.
 */
export function detectInstalledProviders(): Promise<ProviderId[]> {
  return detectWhere(async id => installSignals(id) || await PROVIDERS[id].detect())
}

/** Providers whose default home contains account data that Tokmon can read. */
export function detectAccountProviders(): Promise<ProviderId[]> {
  return detectWhere(id => PROVIDERS[id].detect())
}

/** Backwards-compatible name used by onboarding and installation discovery. */
export const detectProviders = detectInstalledProviders
