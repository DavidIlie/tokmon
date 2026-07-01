import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { envDir } from '../../config'
import type { Account, BillingResult } from '../types'
import {
  cloudCodeBucketsToMetrics,
  cloudCodeSqliteError,
  fetchCloudCodeQuota,
  readAntigravityOAuthToken,
} from '../cloud-code'

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function firstExisting(paths: string[]): Promise<string> {
  for (const path of paths) {
    if (await exists(path)) return path
  }
  return paths[0]
}

async function antigravityStateDb(homeDir?: string): Promise<string> {
  const base = homeDir ?? homedir()
  const tail = ['User', 'globalStorage', 'state.vscdb']
  if (process.platform === 'darwin') {
    const support = join(base, 'Library', 'Application Support')
    const exact = [
      join(support, 'Antigravity IDE', ...tail),
      join(support, 'Antigravity', ...tail),
    ]
    try {
      const entries = await readdir(support, { withFileTypes: true })
      const matches = entries
        .filter(e => e.isDirectory() && e.name.includes('Antigravity'))
        .map(e => join(support, e.name, ...tail))
      return firstExisting([...exact, ...matches])
    } catch {
      return firstExisting(exact)
    }
  }
  if (process.platform === 'win32') {
    const roaming = homeDir ? join(homeDir, 'AppData', 'Roaming') : (envDir('APPDATA') ?? join(base, 'AppData', 'Roaming'))
    return firstExisting([
      join(roaming, 'Antigravity IDE', ...tail),
      join(roaming, 'Antigravity', ...tail),
    ])
  }
  const cfg = homeDir ? join(homeDir, '.config') : (envDir('XDG_CONFIG_HOME') ?? join(base, '.config'))
  return firstExisting([
    join(cfg, 'Antigravity IDE', ...tail),
    join(cfg, 'Antigravity', ...tail),
  ])
}

export async function detectAntigravity(homeDir?: string): Promise<boolean> {
  return exists(await antigravityStateDb(homeDir))
}

export async function antigravityBilling(account: Account): Promise<BillingResult> {
  try {
    const db = await antigravityStateDb(account.homeDir)
    const { token, status } = await readAntigravityOAuthToken(db)
    if (!token) return { plan: null, metrics: [], error: cloudCodeSqliteError(status) }
    const quota = await fetchCloudCodeQuota(token, 'Token expired — open Antigravity')
    if (!quota.ok) return { plan: quota.plan, metrics: [], error: quota.error }
    return { plan: quota.plan, metrics: cloudCodeBucketsToMetrics(quota.buckets, { fullGeminiLabels: true }), error: null }
  } catch {
    return { plan: null, metrics: [], error: 'Antigravity billing unavailable' }
  }
}
