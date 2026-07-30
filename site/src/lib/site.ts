import rootPackage from '../../../package.json' with { type: 'json' }
import { PROVIDER_META } from '../../../src/provider-meta.ts'
import type { ProviderId } from '../../../src/providers/types.ts'

export {
  PROVIDER_MARKS,
  type ProviderMark,
} from '../../../src/desktop/renderer/provider-icons.ts'

// Static content model for the marketing site. Provider names and marks come
// directly from the browser-safe application sources.

export const REPO_OWNER = 'DavidIlie'
export const REPO_NAME = 'tokmon'
export const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`
export const REPO_URL = `https://github.com/${REPO_SLUG}`
export const RELEASES_URL = `${REPO_URL}/releases`
export const NPM_URL = 'https://www.npmjs.com/package/tokmon'
export const THIRD_PARTY_NOTICES_URL = `${REPO_URL}/blob/master/THIRD_PARTY_NOTICES.md`
export const LICENSE_URL = `${REPO_URL}/blob/master/LICENSE`
// Absolute without assuming which domain will eventually host the site.
export const OG_IMAGE_URL = `https://raw.githubusercontent.com/${REPO_SLUG}/master/site/public/screenshot.png`

// Server-rendered release copy follows the repository package version. The
// browser release picker upgrades links and notes from the GitHub API.
export const FALLBACK_VERSION = `v${rootPackage.version}`

export interface ProviderRow {
  id: ProviderId
  name: string
  gives: string
  hue: string
}

const PROVIDER_GIVES: Record<ProviderId, string> = {
  claude: 'Cost and token history, plan, live session and weekly limits',
  codex: 'History, plan, live session and weekly limits, credit balance',
  cursor: 'History, plan, period spend, and on-demand caps',
  copilot: 'Plan, premium-request quota, and chat quota',
  pi: 'Cost and token history using pi\'s recorded cost',
  opencode: 'Cost and token history across routed providers',
  antigravity: 'Plan and quota for Gemini and Claude model pools',
  gemini: 'Plan and live model quota',
  grok: 'History plus SuperGrok and credit usage when signed in',
}

// Ordered to match the provider mark set first, monogram fallbacks last.
const SITE_PROVIDER_IDS = [
  'claude',
  'codex',
  'cursor',
  'copilot',
  'opencode',
  'antigravity',
  'grok',
  'pi',
  'gemini',
] as const satisfies readonly ProviderId[]

export const PROVIDERS: ProviderRow[] = SITE_PROVIDER_IDS.map(id => ({
  id,
  name: PROVIDER_META[id].name,
  gives: PROVIDER_GIVES[id],
  hue: `var(--p-${id})`,
}))
