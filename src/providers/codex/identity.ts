import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { identityFromIdToken } from '../_shared/jwt'

export interface CodexIdentity {
  email?: string
  displayName?: string
}

export function codexAuthPaths(homeDir: string): string[] {
  return [join(homeDir, '.codex', 'auth.json'), join(homeDir, 'auth.json')]
}

export function readCodexIdentity(homeDir: string): CodexIdentity {
  for (const path of codexAuthPaths(homeDir)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8'))
      const { email, displayName, payload } = identityFromIdToken(parsed?.tokens?.id_token)
      if (!payload) continue
      return { email, displayName }
    } catch {}
  }
  return {}
}
