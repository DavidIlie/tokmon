import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Account, BillingResult } from '../types'
import { cloudCodeBucketsToMetrics, fetchCloudCodeQuota } from '../cloud-code'

function geminiCredsPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.gemini', 'oauth_creds.json')
}

export async function detectGemini(homeDir?: string): Promise<boolean> {
  try { await access(geminiCredsPath(homeDir)); return true } catch { return false }
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

function decodeBase64UrlJson(segment: string): any | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
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
    if (!creds || (!accessToken && !refreshToken)) return { plan: null, metrics: [], error: 'Not signed in — run gemini', ...identity }
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
