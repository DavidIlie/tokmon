import { execFile as execFileCb } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { resetIn } from '../../format'
import { readJson } from '../../http'
import type { Account, BillingResult, Metric } from '../types'
import { claudeConfigDirs } from './usage'

const execFile = promisify(execFileCb)

interface OAuthResponse {
  five_hour?: { utilization: number; resets_at: string }
  seven_day?: { utilization: number; resets_at: string }
  seven_day_sonnet?: { utilization: number; resets_at: string } | null
  extra_usage?: {
    is_enabled: boolean
    monthly_limit: number | null
    used_credits: number | null
    currency?: string | null
  } | null
}

async function readCredentialsFile(homeDir?: string): Promise<string | null> {
  // Same dir resolution as the usage parser (honors CLAUDE_CONFIG_DIR lists).
  for (const dir of claudeConfigDirs(homeDir)) {
    try {
      const creds = JSON.parse(await readFile(join(dir, '.credentials.json'), 'utf-8'))
      const token = creds?.claudeAiOauth?.accessToken ?? creds?.accessToken
      if (token) return token
    } catch { /* try next dir */ }
  }
  return null
}

async function readMacKeychain(): Promise<string | null> {
  try {
    const { stdout } = await execFile('security', [
      'find-generic-password', '-s', 'Claude Code-credentials', '-w',
    ], { timeout: 5000 })
    const creds = JSON.parse(stdout.trim())
    return creds?.claudeAiOauth?.accessToken ?? creds?.accessToken ?? null
  } catch {
    return null
  }
}

async function getAccessToken(homeDir?: string): Promise<string | null> {
  const isDefault = !homeDir || homeDir === homedir()
  if (isDefault && process.platform === 'darwin') {
    const token = await readMacKeychain()
    if (token) return token
  }
  return readCredentialsFile(homeDir)
}

const pct = (used: number, resets?: string | null, primary?: boolean): Metric =>
  ({ label: '', used, limit: 100, format: { kind: 'percent' }, resetsAt: resets ?? null, primary })

export async function claudeBilling(account: Account): Promise<BillingResult> {
  const token = await getAccessToken(account.homeDir)
  if (!token) return { plan: null, metrics: [], error: 'No OAuth token — run claude and log in' }

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'tokmon',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (res.status === 429) return { plan: null, metrics: [], error: 'Rate limited — retrying next poll' }
    if (res.status === 401) return { plan: null, metrics: [], error: 'Token expired — restart Claude Code' }
    if (!res.ok) return { plan: null, metrics: [], error: `API ${res.status}` }

    const data = await readJson<OAuthResponse>(res)
    if (!data) return { plan: null, metrics: [], error: 'Unexpected API response' }
    const metrics: Metric[] = []

    if (data.five_hour) {
      metrics.push({ ...pct(data.five_hour.utilization, resetIn(data.five_hour.resets_at), true), label: '5h' })
    }
    if (data.seven_day) {
      metrics.push({ ...pct(data.seven_day.utilization, resetIn(data.seven_day.resets_at)), label: 'Week' })
    }
    if (data.seven_day_sonnet) {
      metrics.push({ ...pct(data.seven_day_sonnet.utilization), label: 'Sonnet' })
    }
    if (data.extra_usage?.is_enabled) {
      metrics.push({
        label: 'Extra',
        used: (data.extra_usage.used_credits ?? 0) / 100,
        limit: data.extra_usage.monthly_limit != null ? data.extra_usage.monthly_limit / 100 : null,
        format: { kind: 'dollars', currency: data.extra_usage.currency ?? 'USD' },
      })
    }

    return { plan: null, metrics, error: null }
  } catch {
    return { plan: null, metrics: [], error: 'Network error' }
  }
}
