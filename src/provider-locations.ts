import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeConfigDirs } from './providers/claude/usage'
import { codexHomes } from './providers/codex/usage'
import { cursorStateDb } from './providers/cursor/billing'
import { copilotStateDirs, ghHostsPath } from './providers/copilot/billing'
import { piSessionsDir } from './providers/pi/usage'
import { opencodeDbPaths } from './providers/opencode/usage'
import { antigravityStateDb } from './providers/antigravity/billing'
import { geminiCredsPath, geminiDir } from './providers/gemini/billing'
import { geminiTmpDir } from './providers/gemini/usage'
import { grokAuthPaths, grokHomes } from './providers/grok/identity'
import type { ProviderId } from './providers/types'

export type ProviderLocationKind = 'config' | 'auth' | 'usage' | 'state'

export interface ProviderLocation {
  kind: ProviderLocationKind
  path: string
  exists: boolean
}

async function location(kind: ProviderLocationKind, path: string): Promise<ProviderLocation> {
  let exists = false
  try { await access(path); exists = true } catch {}
  return { kind, path, exists }
}

function unique(items: Array<[ProviderLocationKind, string]>): Array<[ProviderLocationKind, string]> {
  const seen = new Set<string>()
  return items.filter(([kind, path]) => {
    const key = `${kind}:${path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function providerLocations(providerId: ProviderId, homeDir?: string): Promise<ProviderLocation[]> {
  let candidates: Array<[ProviderLocationKind, string]>
  switch (providerId) {
    case 'claude':
      candidates = claudeConfigDirs(homeDir).flatMap(dir => [
        ['config', dir],
        ['auth', join(dir, '.credentials.json')],
        ['usage', join(dir, 'projects')],
      ] as Array<[ProviderLocationKind, string]>)
      break
    case 'codex':
      candidates = codexHomes(homeDir).flatMap(dir => [
        ['config', dir],
        ['auth', join(dir, 'auth.json')],
        ['usage', join(dir, 'sessions')],
        ['usage', join(dir, 'archived_sessions')],
      ] as Array<[ProviderLocationKind, string]>)
      break
    case 'cursor': {
      const state = cursorStateDb(homeDir)
      candidates = [['state', state], ['usage', state]]
      break
    }
    case 'copilot':
      candidates = [
        ['auth', ghHostsPath(homeDir)],
        ...copilotStateDirs(homeDir).map(path => ['state', path] as [ProviderLocationKind, string]),
      ]
      break
    case 'pi':
      candidates = [['usage', piSessionsDir(homeDir)]]
      break
    case 'opencode':
      candidates = opencodeDbPaths(homeDir).map(path => ['usage', path])
      break
    case 'antigravity':
      candidates = [['state', await antigravityStateDb(homeDir)]]
      break
    case 'gemini':
      candidates = [
        ['config', geminiDir(homeDir)],
        ['auth', geminiCredsPath(homeDir)],
        ['usage', geminiTmpDir(homeDir)],
      ]
      break
    case 'grok':
      candidates = [
        ...grokHomes(homeDir).map(path => ['config', path] as [ProviderLocationKind, string]),
        ...grokAuthPaths(homeDir).map(path => ['auth', path] as [ProviderLocationKind, string]),
        ...grokHomes(homeDir).map(path => ['usage', join(path, 'logs')] as [ProviderLocationKind, string]),
      ]
      break
  }
  return Promise.all(unique(candidates).map(([kind, path]) => location(kind, path)))
}
