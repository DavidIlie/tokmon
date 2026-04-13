import { execFile as execFileCb } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

export interface RateLimit {
  utilization: number
  resetsAt: string
}

export interface PeakStatus {
  state: 'peak' | 'off-peak' | 'weekend'
  label: string
  minutesUntilChange: number | null
}

export interface BillingData {
  session: RateLimit | null
  weekly: RateLimit | null
  sonnet: RateLimit | null
  extraUsage: { limit: number; used: number } | null
  peak: PeakStatus | null
  error: string | null
}

interface OAuthResponse {
  five_hour?: { utilization: number; resets_at: string }
  seven_day?: { utilization: number; resets_at: string }
  seven_day_sonnet?: { utilization: number; resets_at: string } | null
  extra_usage?: { is_enabled: boolean; monthly_limit: number; used_credits: number } | null
}

function credentialsFilePath(): string {
  const base = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  return join(base, '.credentials.json')
}

async function readCredentialsFile(): Promise<string | null> {
  try {
    const raw = await readFile(credentialsFilePath(), 'utf-8')
    const creds = JSON.parse(raw)
    return creds?.claudeAiOauth?.accessToken ?? creds?.accessToken ?? null
  } catch {
    return null
  }
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

async function getAccessToken(): Promise<string | null> {
  if (process.platform === 'darwin') {
    const token = await readMacKeychain()
    if (token) return token
  }
  return readCredentialsFile()
}

const EMPTY: BillingData = { session: null, weekly: null, sonnet: null, extraUsage: null, peak: null, error: null }

export async function fetchBilling(): Promise<BillingData> {
  const token = await getAccessToken()
  if (!token) return { ...EMPTY, error: 'No OAuth token — run claude and log in' }

  const [usageRes, peak] = await Promise.all([
    fetchUsage(token),
    fetchPeakStatus(),
  ])

  if ('error' in usageRes) return { ...EMPTY, peak, error: usageRes.error }
  return { ...usageRes.data, peak, error: null }
}

async function fetchUsage(token: string): Promise<{ data: Omit<BillingData, 'peak' | 'error'> } | { error: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'tokmon',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (res.status === 429) return { error: 'Rate limited — retrying next poll' }
    if (res.status === 401) return { error: 'Token expired — restart Claude Code' }
    if (!res.ok) return { error: `API ${res.status}` }

    const data = await res.json() as OAuthResponse
    return {
      data: {
        session: data.five_hour ? {
          utilization: data.five_hour.utilization,
          resetsAt: formatReset(data.five_hour.resets_at),
        } : null,
        weekly: data.seven_day ? {
          utilization: data.seven_day.utilization,
          resetsAt: formatReset(data.seven_day.resets_at),
        } : null,
        sonnet: data.seven_day_sonnet ? {
          utilization: data.seven_day_sonnet.utilization,
          resetsAt: formatReset(data.seven_day_sonnet.resets_at),
        } : null,
        extraUsage: data.extra_usage?.is_enabled ? {
          limit: data.extra_usage.monthly_limit / 100,
          used: data.extra_usage.used_credits / 100,
        } : null,
      },
    }
  } catch {
    return { error: 'Network error' }
  }
}

interface PromoClockResponse {
  status?: string
  isPeak?: boolean
  isOffPeak?: boolean
  isWeekend?: boolean
  label?: string
  minutesUntilChange?: number
}

async function fetchPeakStatus(): Promise<PeakStatus | null> {
  try {
    const res = await fetch('https://promoclock.co/api/status', {
      headers: { 'Accept': 'application/json', 'User-Agent': 'tokmon' },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const data = await res.json() as PromoClockResponse

    let state: PeakStatus['state']
    if (data.isPeak === true || data.status === 'peak') state = 'peak'
    else if (data.isWeekend === true || data.status === 'weekend') state = 'weekend'
    else if (data.isOffPeak === true || data.status === 'off_peak' || data.status === 'off-peak') state = 'off-peak'
    else return null

    return {
      state,
      label: state === 'peak' ? 'Peak' : state === 'weekend' ? 'Weekend' : 'Off-Peak',
      minutesUntilChange: typeof data.minutesUntilChange === 'number' ? data.minutesUntilChange : null,
    }
  } catch {
    return null
  }
}

function formatReset(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff <= 0) return 'now'

  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `${mins}m`

  const hrs = Math.floor(mins / 60)
  const m = mins % 60
  if (hrs < 24) return `${hrs}h ${m}m`

  const days = Math.floor(hrs / 24)
  const h = hrs % 24
  return `${days}d ${h}h`
}
