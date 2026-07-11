import { stat as fsStat, access } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, finitePositive, dashboardSince, tableSince, walkFiles } from '../usage-core'
import { timestampMs } from '../_shared/time'

export function piSessionsDir(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.pi', 'agent', 'sessions')
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
  const stream = createReadStream(path)
  stream.on('error', () => {})
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const rawLine of rl) {
      if (!rawLine.includes('"usage"')) continue
      try {
        const line = rawLine.charCodeAt(0) === 0xFEFF ? rawLine.slice(1) : rawLine
        const entry = recordToEntry(JSON.parse(line))
        if (entry) entries.push(entry)
      } catch {}
    }
  } catch {
    return entries
  } finally {
    rl.close()
    stream.destroy()
  }
  return entries
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const dir = piSessionsDir(homeDir)
  const files: { path: string; mtimeMs: number; size: number }[] = []
  const seenIno = new Set<string>()
  const listing = await walkFiles(dir)
  for (const f of listing) {
    if (!f.endsWith('.jsonl')) continue
    const path = join(dir, f)
    try {
      const s = await fsStat(path)
      if (s.mtimeMs < since) continue
      if (s.ino && process.platform !== 'win32') {
        const idn = `${s.dev}:${s.ino}`
        if (seenIno.has(idn)) continue
        seenIno.add(idn)
      }
      files.push({ path, mtimeMs: s.mtimeMs, size: s.size })
    } catch {}
  }
  return loadCachedEntries(files, parseFile, since)
}

export async function piDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  return summarize(await loadEntries(dashboardSince(tz), homeDir), tz)
}

export async function piTable(tz: string, homeDir?: string): Promise<TableData> {
  return tabulate(await loadEntries(tableSince(tz), homeDir), tz)
}
