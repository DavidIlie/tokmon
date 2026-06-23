import { execFile as execFileCb } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { resetIn } from '../../format'
import { envDir } from '../../config'
import { readJson } from '../../http'
import type { Account, BillingResult, Metric } from '../types'
import { readMacKeychainRaw, unwrapGoKeyringBase64 } from '../_shared/keychain'

const execFile = promisify(execFileCb)
const USAGE_URL = 'https://api.github.com/copilot_internal/user'
const GH_KEYCHAIN_SERVICE = 'gh:github.com'

interface TokenSource {
  token: string
  source: string
}

interface QuotaSnapshot {
  percent_remaining?: number
  entitlement?: number
  unlimited?: boolean
}

interface CopilotUsage {
  copilot_plan?: string
  quota_reset_date?: string
  quota_snapshots?: {
    premium_interactions?: QuotaSnapshot
    chat?: QuotaSnapshot
  }
  limited_user_reset_date?: string
  limited_user_quotas?: {
    chat?: number
    completions?: number
  }
  monthly_quotas?: {
    chat?: number
    completions?: number
  }
}

function ghConfigDir(homeDir?: string): string {
  if (!homeDir) {
    const explicit = process.env.GH_CONFIG_DIR
    if (explicit && explicit.trim()) return explicit.trim()
    if (process.platform === 'win32') {
      return join(envDir('APPDATA') ?? join(homedir(), 'AppData', 'Roaming'), 'GitHub CLI')
    }
    const xdg = envDir('XDG_CONFIG_HOME')
    return xdg ? join(xdg, 'gh') : join(homedir(), '.config', 'gh')
  }
  return process.platform === 'win32'
    ? join(homeDir, 'AppData', 'Roaming', 'GitHub CLI')
    : join(homeDir, '.config', 'gh')
}

export function ghHostsPath(homeDir?: string): string {
  return join(ghConfigDir(homeDir), 'hosts.yml')
}

export async function detectCopilot(homeDir?: string): Promise<boolean> {
  try {
    await access(ghHostsPath(homeDir))
    return true
  } catch {}

  try {
    await execFile('gh', ['--version'], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

function unquoteYamlValue(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function tokenFromHostsYaml(raw: string): string | null {
  const lines = raw.split(/\r?\n/)
  let inGithub = false
  let githubIndent = -1

  for (const line of lines) {
    const match = line.match(/^(\s*)([^:#][^:]*):\s*(.*)$/)
    if (!match) continue

    const indent = match[1].length
    const key = match[2].trim()
    const value = match[3].trim()

    if (indent === 0) {
      inGithub = key === 'github.com'
      githubIndent = inGithub ? indent : -1
      continue
    }

    if (inGithub && indent > githubIndent && key === 'oauth_token' && value) {
      return unquoteYamlValue(value)
    }
  }

  return null
}

async function loadTokenFromHosts(homeDir?: string): Promise<TokenSource | null> {
  try {
    const token = tokenFromHostsYaml(await readFile(ghHostsPath(homeDir), 'utf-8'))
    return token ? { token, source: 'gh-hosts' } : null
  } catch {
    return null
  }
}

async function readMacKeychainService(service: string): Promise<string | null> {
  const raw = await readMacKeychainRaw(service)
  return raw ? unwrapGoKeyringBase64(raw) : null
}

async function loadTokenFromGhKeychain(): Promise<TokenSource | null> {
  const token = await readMacKeychainService(GH_KEYCHAIN_SERVICE)
  return token ? { token, source: 'gh-keychain' } : null
}

function vscodeUserDir(homeDir?: string): string {
  const home = homeDir ?? homedir()
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Code', 'User')
  if (process.platform === 'win32') return join(home, 'AppData', 'Roaming', 'Code', 'User')
  return join(home, '.config', 'Code', 'User')
}

function tokenFromText(raw: string): string | null {
  const patterns = [
    /github\.com[^A-Za-z0-9_]+oauth_token[^A-Za-z0-9_]+([A-Za-z0-9_]{20,})/i,
    /github\.com[^A-Za-z0-9_]+(gh[opusr]_[A-Za-z0-9_]{20,})/i,
    /\b(gh[opusr]_[A-Za-z0-9_]{20,})\b/,
  ]
  for (const pattern of patterns) {
    const token = raw.match(pattern)?.[1]
    if (token) return token
  }
  return null
}

async function loadTokenFromVsCode(homeDir?: string): Promise<TokenSource | null> {
  const userDir = vscodeUserDir(homeDir)
  const candidates = [
    join(userDir, 'globalStorage', 'github.copilot-chat', 'auth.json'),
    join(userDir, 'globalStorage', 'github.copilot', 'auth.json'),
    join(userDir, 'globalStorage', 'state.vscdb'),
  ]

  try {
    for (const dirent of await readdir(join(userDir, 'globalStorage'), { withFileTypes: true })) {
      if (dirent.isDirectory() && dirent.name.toLowerCase().includes('github')) {
        candidates.push(join(userDir, 'globalStorage', dirent.name, 'auth.json'))
      }
    }
  } catch {}

  for (const path of candidates) {
    try {
      const token = tokenFromText(await readFile(path, 'utf-8'))
      if (token) return { token, source: 'vscode' }
    } catch {}
  }

  return null
}

async function loadToken(homeDir?: string): Promise<TokenSource | null> {
  return (
    await loadTokenFromHosts(homeDir) ||
    await loadTokenFromGhKeychain() ||
    await loadTokenFromVsCode(homeDir)
  )
}

function redactToken(token: string): string {
  return token.length <= 4 ? '****' : `****${token.slice(-4)}`
}

function resetDate(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? resetIn(value) : null
}

function percentMetric(label: string, snapshot: QuotaSnapshot | undefined, reset: string | null, primary?: boolean): Metric | null {
  if (!snapshot || typeof snapshot.percent_remaining !== 'number' || !Number.isFinite(snapshot.percent_remaining)) return null
  if (snapshot.unlimited === true || snapshot.entitlement === 0) return null
  const used = Math.min(100, Math.max(0, 100 - snapshot.percent_remaining))
  return {
    label,
    used,
    limit: 100,
    format: { kind: 'percent' },
    resetsAt: reset,
    ...(primary === undefined ? {} : { primary }),
  }
}

function countMetric(label: string, remaining: unknown, total: unknown, reset: string | null): Metric | null {
  if (
    typeof remaining !== 'number'
    || typeof total !== 'number'
    || !Number.isFinite(remaining)
    || !Number.isFinite(total)
    || total <= 0
  ) return null
  return {
    label,
    used: Math.max(0, total - remaining),
    limit: total,
    format: { kind: 'count' },
    resetsAt: reset,
  }
}

async function fetchUsage(token: string): Promise<{ data: CopilotUsage | null; status: number | null }> {
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/json',
        'Editor-Version': 'vscode/1.96.2',
        'Editor-Plugin-Version': 'copilot-chat/0.26.7',
        'User-Agent': 'GitHubCopilotChat/0.26.7',
        'X-Github-Api-Version': '2025-04-01',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { data: null, status: res.status }
    return { data: await readJson<CopilotUsage>(res), status: res.status }
  } catch {
    return { data: null, status: null }
  }
}

export async function copilotBilling(account: Account): Promise<BillingResult> {
  const cred = await loadToken(account.homeDir)
  if (!cred) return { plan: null, metrics: [], error: 'Not logged in — run gh auth login' }

  const { data, status } = await fetchUsage(cred.token)
  if (!data) {
    if (status === 401 || status === 403) {
      return { plan: null, metrics: [], error: `Token invalid (${redactToken(cred.token)}) — run gh auth login` }
    }
    if (status) return { plan: null, metrics: [], error: `Copilot API ${status}` }
    return { plan: null, metrics: [], error: 'Network error' }
  }

  const plan = typeof data.copilot_plan === 'string' && data.copilot_plan.trim() ? data.copilot_plan : null
  const metrics: Metric[] = []
  const quotaReset = resetDate(data.quota_reset_date)
  const snapshots = data.quota_snapshots

  const premium = percentMetric('Premium', snapshots?.premium_interactions, quotaReset, true)
  if (premium) metrics.push(premium)

  const chat = percentMetric('Chat', snapshots?.chat, quotaReset)
  if (chat) metrics.push(chat)

  if (data.limited_user_quotas && data.monthly_quotas) {
    const reset = resetDate(data.limited_user_reset_date)
    const limitedChat = countMetric('Chat', data.limited_user_quotas.chat, data.monthly_quotas.chat, reset)
    if (limitedChat) metrics.push(limitedChat)

    const completions = countMetric('Completions', data.limited_user_quotas.completions, data.monthly_quotas.completions, reset)
    if (completions) metrics.push(completions)
  }

  if (metrics.length === 0) return { plan, metrics: [], error: 'No usage data' }
  return { plan, metrics, error: null }
}
