import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Account, BillingResult } from '../types'
import { decodeBase64UrlJson } from '../_shared/jwt'
import { cloudCodeBucketsToMetrics, fetchCloudCodeQuota } from '../cloud-code'
import { geminiTmpDir } from './usage'

function geminiCredsPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.gemini', 'oauth_creds.json')
}

function geminiDir(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.gemini')
}

type GeminiAuthMethod = 'api-key' | 'vertex' | 'none'

function authTypeFromSettings(settings: any): GeminiAuthMethod {
  const raw = settings?.security?.auth?.selectedType ?? settings?.selectedAuthType
  if (typeof raw !== 'string') return 'none'
  const value = raw.trim().toLowerCase()
  if (!value) return 'none'
  if (value.includes('vertex') || value.includes('use_vertex_ai')) return 'vertex'
  if (value.includes('gemini-api-key') || value.includes('api-key') || value.includes('use_gemini')) return 'api-key'
  return 'none'
}

async function authMethodFromSettings(homeDir?: string): Promise<GeminiAuthMethod> {
  try {
    const raw = await readFile(join(geminiDir(homeDir), 'settings.json'), 'utf8')
    return authTypeFromSettings(JSON.parse(raw))
  } catch {
    return 'none'
  }
}

async function hasGeminiApiKeyFile(homeDir?: string): Promise<boolean> {
  try { await access(join(geminiDir(homeDir), 'api_key')); return true } catch {}
  try {
    const env = await readFile(join(geminiDir(homeDir), '.env'), 'utf8')
    return /^\s*GEMINI_API_KEY\s*=/m.test(env)
  } catch {
    return false
  }
}

function hasGeminiApiKeyEnv(): boolean {
  return ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY']
    .some(name => typeof process.env[name] === 'string' && process.env[name]!.trim() !== '')
}

async function noOAuthAuthMessage(homeDir?: string): Promise<string> {
  const settingsMethod = await authMethodFromSettings(homeDir)
  if (settingsMethod === 'api-key') return 'API key auth — quota needs Google login (run gemini)'
  if (settingsMethod === 'vertex') return 'Vertex AI auth — quota needs Google login (run gemini)'
  if (await hasGeminiApiKeyFile(homeDir) || hasGeminiApiKeyEnv()) {
    return 'API key auth — quota needs Google login (run gemini)'
  }
  return 'Not signed in — run gemini and log in with Google'
}

export async function detectGemini(homeDir?: string): Promise<boolean> {
  let oauthOk = false
  try { await access(geminiCredsPath(homeDir)); oauthOk = true } catch {}
  return oauthOk || await hasGeminiChatSessions(homeDir)
}

async function hasGeminiChatSessions(homeDir?: string): Promise<boolean> {
  let listing: string[]
  try {
    listing = await readdir(geminiTmpDir(homeDir), { recursive: true })
  } catch {
    return false
  }
  return listing.some(path => /(^|[\\/])chats[\\/]session-.*\.jsonl$/.test(path))
}

interface GeminiCreds {
  access_token?: string
  refresh_token?: string
  expiry_date?: number
  id_token?: string
  email?: string
  displayName?: string
  name?: string
}

function geminiIdentity(creds: GeminiCreds | null): Pick<BillingResult, 'email' | 'displayName'> {
  const tokenPayload = typeof creds?.id_token === 'string' && creds.id_token.includes('.')
    ? decodeBase64UrlJson(creds.id_token.split('.')[1])
    : null
  const email =
    (typeof creds?.email === 'string' && creds.email.trim())
    || (typeof tokenPayload?.email === 'string' && tokenPayload.email.trim())
    || null
  const displayName =
    (typeof creds?.displayName === 'string' && creds.displayName.trim())
    || (typeof creds?.name === 'string' && creds.name.trim())
    || (typeof tokenPayload?.name === 'string' && tokenPayload.name.trim())
    || null
  return { email, displayName }
}

async function readGeminiCreds(path: string): Promise<GeminiCreds | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as GeminiCreds
  } catch {
    return null
  }
}

export async function geminiBilling(account: Account): Promise<BillingResult> {
  try {
    const creds = await readGeminiCreds(geminiCredsPath(account.homeDir))
    const identity = geminiIdentity(creds)
    const accessToken = typeof creds?.access_token === 'string' ? creds.access_token.trim() : ''
    const refreshToken = typeof creds?.refresh_token === 'string' ? creds.refresh_token.trim() : null
    if (!creds || (!accessToken && !refreshToken)) {
      return {
        plan: null,
        metrics: [],
        error: await noOAuthAuthMessage(account.homeDir),
        ...identity,
      }
    }
    const quota = await fetchCloudCodeQuota({
      accessToken,
      refreshToken,
      expirySeconds: typeof creds.expiry_date === 'number' ? Math.floor(creds.expiry_date / 1000) : null,
    }, 'Token expired — run gemini')
    if (!quota.ok) return { plan: quota.plan, metrics: [], error: quota.error, ...identity }
    return { plan: quota.plan, metrics: cloudCodeBucketsToMetrics(quota.buckets), error: null, ...identity }
  } catch {
    return { plan: null, metrics: [], error: 'Gemini billing unavailable' }
  }
}
