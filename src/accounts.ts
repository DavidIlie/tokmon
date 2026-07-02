import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { type Config, expandHome, slugify } from './config'
import { PROVIDER_ORDER, PROVIDERS } from './providers'
import { readClaudeIdentity } from './providers/claude/identity'
import { codexAuthPaths, readCodexIdentity } from './providers/codex/identity'
import type { Account, ProviderId } from './providers/types'

interface DiscoveredAccount {
  id: string
  providerId: ProviderId
  name: string
  color: string
  homeDir?: string
}

function accountKey(providerId: ProviderId, homeDir?: string): string {
  return `${providerId}:${homeDir ? resolve(expandHome(homeDir)) : homedir()}`
}

function uniqueId(base: string, used: Set<string>): string {
  let id = slugify(base) || 'account'
  if (!used.has(id)) {
    used.add(id)
    return id
  }
  for (let i = 2; i < 1000; i++) {
    const next = `${id}_${i}`
    if (!used.has(next)) {
      used.add(next)
      return next
    }
  }
  id = `${id}_${Date.now()}`
  used.add(id)
  return id
}

function hasClaudeState(homeDir: string): boolean {
  return existsSync(join(homeDir, '.claude.json'))
    || existsSync(join(homeDir, '.claude', '.credentials.json'))
    || existsSync(join(homeDir, '.claude', 'projects'))
    || existsSync(join(homeDir, '.config', 'claude', '.credentials.json'))
    || existsSync(join(homeDir, '.config', 'claude', 'projects'))
}

function candidateAlternateHomes(prefix: string): string[] {
  const home = homedir()
  let entries: string[]
  try {
    entries = readdirSync(home)
  } catch {
    return []
  }
  const out: string[] = []
  const pattern = new RegExp(`^\\.${prefix}[_-]`)
  for (const name of entries) {
    if (!pattern.test(name)) continue
    const path = join(home, name)
    try {
      if (!statSync(path).isDirectory()) continue
      out.push(path)
    } catch {}
  }
  return out.sort()
}

function labelForClaudeHome(homeDir: string): string {
  const identity = readClaudeIdentity(homeDir)
  if (identity.email) return `Claude ${identity.email}`
  if (identity.displayName) return `Claude ${identity.displayName}`
  const raw = basename(homeDir).replace(/^\.claude[_-]?/, '').replace(/[_-]+/g, ' ').trim()
  return raw ? `Claude ${raw}` : 'Claude'
}

function hasCodexAuth(homeDir: string): boolean {
  for (const path of codexAuthPaths(homeDir)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8'))
      const accessToken = parsed?.tokens?.access_token
      if (typeof accessToken === 'string' && accessToken.trim()) return true
    } catch {}
  }
  return false
}

function labelForCodexHome(homeDir: string): string {
  const identity = readCodexIdentity(homeDir)
  if (identity.email) return `Codex ${identity.email}`
  if (identity.displayName) return `Codex ${identity.displayName}`
  const raw = basename(homeDir).replace(/^\.codex[_-]?/, '').replace(/[_-]+/g, ' ').trim()
  return raw ? `Codex ${raw}` : 'Codex'
}

function discoverClaudeAccounts(usedIds: Set<string>): DiscoveredAccount[] {
  const provider = PROVIDERS.claude
  const out: DiscoveredAccount[] = []
  for (const homeDir of candidateAlternateHomes('claude')) {
    if (!hasClaudeState(homeDir)) continue
    const suffix = basename(homeDir).replace(/^\.claude[_-]?/, '') || basename(homeDir)
    out.push({
      id: uniqueId(`claude_${suffix}`, usedIds),
      providerId: 'claude',
      name: labelForClaudeHome(homeDir),
      color: provider.color,
      homeDir,
    })
  }
  return out
}

function discoverCodexAccounts(usedIds: Set<string>): DiscoveredAccount[] {
  const provider = PROVIDERS.codex
  const out: DiscoveredAccount[] = []
  for (const homeDir of candidateAlternateHomes('codex')) {
    if (!hasCodexAuth(homeDir)) continue
    const suffix = basename(homeDir).replace(/^\.codex[_-]?/, '') || basename(homeDir)
    out.push({
      id: uniqueId(`codex_${suffix}`, usedIds),
      providerId: 'codex',
      name: labelForCodexHome(homeDir),
      color: provider.color,
      homeDir,
    })
  }
  return out
}

function discoverProviderAccounts(providerId: ProviderId, usedIds: Set<string>): DiscoveredAccount[] {
  if (providerId === 'claude') return discoverClaudeAccounts(usedIds)
  if (providerId === 'codex') return discoverCodexAccounts(usedIds)
  return []
}

export function buildAccounts(config: Config, detected: ProviderId[]): Account[] {
  const out: Account[] = []
  const usedIds = new Set(config.accounts.map(a => a.id))
  const seenKeys = new Set<string>()

  const add = (account: Account): void => {
    const key = accountKey(account.providerId, account.homeDir)
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    out.push(account)
  }

  for (const pid of PROVIDER_ORDER) {
    if (config.disabledProviders.includes(pid)) continue
    const provider = PROVIDERS[pid]
    const configured = config.accounts.filter(a => a.providerId === pid)
    for (const a of configured) {
      add({
        id: a.id,
        providerId: pid,
        name: a.name,
        color: a.color || provider.color,
        homeDir: a.homeDir && a.homeDir !== '~' ? expandHome(a.homeDir) : undefined,
      })
    }

    const discovered = discoverProviderAccounts(pid, usedIds)
    if (detected.includes(pid)) {
      add({ id: pid, providerId: pid, name: provider.name, color: provider.color, homeDir: undefined })
    }
    for (const account of discovered) {
      add(account)
    }
  }
  return out
}

export function accountsByProvider(accounts: Account[]): { provider: ProviderId; accounts: Account[] }[] {
  const groups: { provider: ProviderId; accounts: Account[] }[] = []
  for (const pid of PROVIDER_ORDER) {
    const list = accounts.filter(a => a.providerId === pid)
    if (list.length > 0) groups.push({ provider: pid, accounts: list })
  }
  return groups
}
