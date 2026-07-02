import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { expandHome } from '../../config'

export interface ClaudeIdentity {
  email?: string
  displayName?: string
  plan?: string
  accountUuid?: string
}

function titleWords(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function claudeOrgPlanLabel(orgType: unknown): string | null {
  if (typeof orgType !== 'string' || !orgType.trim()) return null
  const normalized = orgType.trim().toLowerCase()
  const stripped = normalized.startsWith('claude_') ? normalized.slice('claude_'.length) : normalized
  const label = titleWords(stripped)
  return label ? `Claude ${label}` : null
}

export function readClaudeIdentity(homeDir?: string): ClaudeIdentity {
  const base = homeDir ? expandHome(homeDir) : homedir()
  try {
    const parsed = JSON.parse(readFileSync(join(base, '.claude.json'), 'utf-8'))
    const oauth = parsed?.oauthAccount
    const email = typeof oauth?.emailAddress === 'string' && oauth.emailAddress.trim()
      ? oauth.emailAddress.trim()
      : undefined
    const displayName = typeof oauth?.displayName === 'string' && oauth.displayName.trim()
      ? oauth.displayName.trim()
      : undefined
    const plan = claudeOrgPlanLabel(parsed?.organizationType)
    const accountUuid = typeof oauth?.accountUuid === 'string' && oauth.accountUuid.trim()
      ? oauth.accountUuid.trim()
      : undefined
    return { email, displayName, plan: plan ?? undefined, accountUuid }
  } catch {
    return {}
  }
}
