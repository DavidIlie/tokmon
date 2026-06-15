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
    const accessToken = typeof creds?.access_token === 'string' ? creds.access_token.trim() : ''
    const refreshToken = typeof creds?.refresh_token === 'string' ? creds.refresh_token.trim() : null
    if (!creds || (!accessToken && !refreshToken)) return { plan: null, metrics: [], error: 'Not signed in — run gemini' }
    // Don't hard-fail on a past expiry_date — a refresh_token is present, so let
    // the Cloud Code path refresh (it returns the error itself if refresh fails).
    const quota = await fetchCloudCodeQuota({
      accessToken,
      refreshToken,
      expirySeconds: typeof creds.expiry_date === 'number' ? Math.floor(creds.expiry_date / 1000) : null,
    }, 'Token expired — run gemini')
    if (!quota.ok) return { plan: quota.plan, metrics: [], error: quota.error }
    return { plan: quota.plan, metrics: cloudCodeBucketsToMetrics(quota.buckets), error: null }
  } catch {
    return { plan: null, metrics: [], error: 'Gemini billing unavailable' }
  }
}
