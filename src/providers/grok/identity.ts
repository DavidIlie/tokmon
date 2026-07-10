import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { envDir, expandHome } from '../../config'
import { decodeBase64UrlJson } from '../_shared/jwt'

export interface GrokIdentity {
  email?: string
  displayName?: string
  userId?: string
  teamId?: string
  tier?: number
  expiresAt?: number
}

export interface GrokAuthEntry {
  key: string
  refresh_token?: string
  expires_at?: string
  create_time?: string
  email?: string
  first_name?: string
  user_id?: string
  team_id?: string
  auth_mode?: string
  oidc_issuer?: string
  oidc_client_id?: string
}

/** GROK_HOME wins; alt accounts pass homeDir (either a grok home or a user home containing `.grok`). */
export function grokHomes(homeDir?: string): string[] {
  if (homeDir) {
    const base = expandHome(homeDir)
    return [...new Set([join(base, '.grok'), base])]
  }
  const homes: string[] = []
  const env = envDir('GROK_HOME')
  if (env) homes.push(env)
  homes.push(join(homedir(), '.grok'))
  return [...new Set(homes)]
}

export function grokAuthPaths(homeDir?: string): string[] {
  const explicit = homeDir ? undefined : process.env.GROK_AUTH_PATH
  const paths = grokHomes(homeDir).map(h => join(h, 'auth.json'))
  return explicit ? [explicit, ...paths] : paths
}

function isAuthEntry(v: unknown): v is GrokAuthEntry {
  return !!v && typeof v === 'object' && typeof (v as GrokAuthEntry).key === 'string' && !!(v as GrokAuthEntry).key
}

/** Prefer grok.com OIDC session over API-key scopes (billing needs session auth). */
export function readGrokAuth(homeDir?: string): GrokAuthEntry | null {
  const inline = homeDir ? undefined : process.env.GROK_AUTH?.trim()
  if (inline) {
    try {
      const parsed = JSON.parse(inline)
      const fromInline = pickAuthEntry(parsed)
      if (fromInline) return fromInline
    } catch { /* fall through to files */ }
  }

  for (const path of grokAuthPaths(homeDir)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8'))
      const entry = pickAuthEntry(parsed)
      if (entry) return entry
    } catch { /* try next */ }
  }
  return null
}

function pickAuthEntry(parsed: unknown): GrokAuthEntry | null {
  if (!parsed || typeof parsed !== 'object') return null
  const map = parsed as Record<string, unknown>

  // Flat single-entry shape (defensive)
  if (isAuthEntry(map)) return map

  const preferred = [
    'https://accounts.x.ai/sign-in',
    'https://auth.x.ai',
  ]
  for (const key of preferred) {
    if (isAuthEntry(map[key])) return map[key]
  }

  const entries = Object.entries(map)
    .filter(([, v]) => isAuthEntry(v))
    .map(([k, v]) => ({ key: k, entry: v as GrokAuthEntry }))
  if (entries.length === 0) return null

  // Skip API-key scopes for billing preference; still usable as last resort for identity.
  const session = entries.filter(e => e.key !== 'xai::api_key' && !e.key.startsWith('xai::'))
  const pool = session.length ? session : entries
  const authTime = (entry: GrokAuthEntry): number => {
    const value = Date.parse(entry.create_time ?? entry.expires_at ?? '')
    return Number.isFinite(value) ? value : 0
  }
  return pool.sort((a, b) => authTime(b.entry) - authTime(a.entry))[0]?.entry ?? null
}

export function readGrokIdentity(homeDir?: string): GrokIdentity {
  const entry = readGrokAuth(homeDir)
  if (!entry) return {}
  const payload = entry.key.includes('.') ? decodeBase64UrlJson(entry.key.split('.')[1]) : null
  const tier = typeof payload?.tier === 'number' ? payload.tier : undefined
  const expiresAt = entry.expires_at ? Date.parse(entry.expires_at) : undefined
  return {
    email: typeof entry.email === 'string' ? entry.email : undefined,
    displayName: typeof entry.first_name === 'string' ? entry.first_name : undefined,
    userId: typeof entry.user_id === 'string' ? entry.user_id : undefined,
    teamId: typeof entry.team_id === 'string' ? entry.team_id : undefined,
    tier,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
  }
}

export function grokClientVersion(homeDir?: string): string {
  for (const home of grokHomes(homeDir)) {
    try {
      const v = readFileSync(join(home, '.metadata_version'), 'utf-8').trim()
      if (v) return v
    } catch { /* next */ }
  }
  return '0.2.93'
}
