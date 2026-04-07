import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)

export interface BillingData {
  session: { utilization: number; resetsAt: string } | null
  weekly: { utilization: number; resetsAt: string } | null
  sonnet: { utilization: number; resetsAt: string } | null
  extraUsage: { limit: number; used: number } | null
}

interface OAuthResponse {
  five_hour?: { utilization: number; resets_at: string }
  seven_day?: { utilization: number; resets_at: string }
  seven_day_sonnet?: { utilization: number; resets_at: string } | null
  extra_usage?: { is_enabled: boolean; monthly_limit: number; used_credits: number } | null
}

async function getAccessToken(): Promise<string | null> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFile('security', [
        'find-generic-password', '-s', 'Claude Code-credentials', '-w',
      ], { timeout: 5000 })
      const creds = JSON.parse(stdout.trim())
      return creds?.claudeAiOauth?.accessToken ?? null
    } catch {
      return null
    }
  }
  return null
}

export async function fetchBilling(): Promise<BillingData | null> {
  const token = await getAccessToken()
  if (!token) return null

  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'tokmon',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json() as OAuthResponse
    return {
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
