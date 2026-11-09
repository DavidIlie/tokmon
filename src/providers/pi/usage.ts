import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { DashboardData, TableData } from '../../types'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, finitePositive, dashboardSince, tableSince, collectSessionFiles } from '../usage-core'
import { readJsonLines } from '../_shared/jsonl'
import { timestampMs } from '../_shared/time'

// Checked 2026-11-09: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/config.ts
// Session override precedence: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/main.ts
// Path normalization: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/utils/paths.ts
function expandPiPath(path: string): string {
  if (process.platform === 'win32' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')) {
    const drive = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i)
    if (drive) path = `${drive[1].toUpperCase()}:\\${(drive[2] ?? '').replaceAll('/', '\\')}`
  }
  if (path === '~') return homedir()
  if (path.startsWith('~/') || (process.platform === 'win32' && path.startsWith('~\\'))) return join(homedir(), path.slice(2))
  return path.startsWith('file://') ? fileURLToPath(path) : path
}

export function piSessionsDir(homeDir?: string): string {
  if (homeDir !== undefined) return join(homeDir, '.pi', 'agent', 'sessions')
  if (process.env.PI_CODING_AGENT_SESSION_DIR) return expandPiPath(process.env.PI_CODING_AGENT_SESSION_DIR)
  const agent = process.env.PI_CODING_AGENT_DIR
  return join(agent ? expandPiPath(agent) : join(homedir(), '.pi', 'agent'), 'sessions')
}

export async function detectPi(homeDir?: string): Promise<boolean> {
  try { await access(piSessionsDir(homeDir)); return true } catch { return false }
}

// Pure conversion of one parsed session-log record into an Entry. Cost is
// trusted from the log (usage.cost.total); cacheSavings is derived from the
// input rate applied to cached reads, floored at 0. Returns null for records
// that are not assistant usage messages or that carry no tokens.
export function recordToEntry(obj: any): Entry | null {
  if (obj?.type !== 'message') return null
  const msg = obj.message
  if (msg?.role !== 'assistant' || !msg?.usage) return null
  const u = msg.usage
  const ts = timestampMs(obj.timestamp ?? msg.timestamp)
  if (ts === null) return null
  const input = safeNum(u.input)
  const output = safeNum(u.output)
  const cacheRead = safeNum(u.cacheRead)
  const cacheCreate = safeNum(u.cacheWrite)
  if (input + output + cacheRead + cacheCreate === 0) return null
  const c = u.cost ?? {}
  const costInput = finitePositive(c.input)
  const cacheSavings = input > 0 && cacheRead > 0
    ? Math.max(0, cacheRead * (costInput / input) - finitePositive(c.cacheRead))
    : 0
  const model = (typeof msg.responseModel === 'string' && msg.responseModel)
    || (typeof msg.model === 'string' && msg.model)
    || 'unknown'
  return {
    ts,
    model,
    cost: finitePositive(c.total),
    input,
    output,
    cacheCreate,
    cacheRead,
    cacheSavings,
  }
}

async function parseFile(path: string): Promise<Entry[]> {
  const entries: Entry[] = []
  for await (const obj of readJsonLines(path, line => line.includes('"usage"'))) {
    const entry = recordToEntry(obj)
    if (entry) entries.push(entry)
  }
  return entries
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const dir = piSessionsDir(homeDir)
  const files = await collectSessionFiles([dir], path => path.endsWith('.jsonl'), since)
  return loadCachedEntries(files, parseFile, since)
}

export async function piDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  return summarize(await loadEntries(dashboardSince(tz), homeDir), tz)
}

export async function piTable(tz: string, homeDir?: string): Promise<TableData> {
  return tabulate(await loadEntries(tableSince(tz), homeDir), tz)
}
