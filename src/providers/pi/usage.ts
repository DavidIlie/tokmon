import { readdir, stat as fsStat, access } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { startOfMonth, startOfWeek, monthsAgoStart } from '../../tz'
import { type Entry, summarize, tabulate, SPARK_DAYS, loadCachedEntries, safeNum } from '../usage-core'

export function piSessionsDir(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.pi', 'agent', 'sessions')
}

export async function detectPi(homeDir?: string): Promise<boolean> {
  try { await access(piSessionsDir(homeDir)); return true } catch { return false }
}

function pos(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

async function parseFile(path: string): Promise<Entry[]> {
  const entries: Entry[] = []
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const rawLine of rl) {
    if (!rawLine.includes('"usage"')) continue
    try {
      const line = rawLine.charCodeAt(0) === 0xFEFF ? rawLine.slice(1) : rawLine
      const obj: any = JSON.parse(line)
      if (obj?.type !== 'message') continue
      const msg = obj.message
      if (msg?.role !== 'assistant' || !msg?.usage) continue
      const u = msg.usage
      const ts = new Date(obj.timestamp ?? msg.timestamp ?? 0).getTime()
      if (!Number.isFinite(ts)) continue
      const input = safeNum(u.input)
      const output = safeNum(u.output)
      const cacheRead = safeNum(u.cacheRead)
      const cacheCreate = safeNum(u.cacheWrite)
      if (input + output + cacheRead + cacheCreate === 0) continue
      const c = u.cost ?? {}
      const costInput = pos(c.input)
      const cacheSavings = input > 0 && cacheRead > 0
        ? Math.max(0, cacheRead * (costInput / input) - pos(c.cacheRead))
        : 0
      const model = (typeof msg.responseModel === 'string' && msg.responseModel)
        || (typeof msg.model === 'string' && msg.model)
        || 'unknown'
      entries.push({
        ts,
        model,
        cost: pos(c.total),
        input,
        output,
        cacheCreate,
        cacheRead,
        cacheSavings,
      })
    } catch { /* skip a single malformed line */ }
  }
  return entries
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const dir = piSessionsDir(homeDir)
  const files: { path: string; mtimeMs: number; size: number }[] = []
  const seenIno = new Set<string>()
  let listing: string[]
  try {
    listing = await readdir(dir, { recursive: true })
  } catch {
    return []
  }
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
  const now = Date.now()
  const since = Math.min(startOfMonth(now, tz), startOfWeek(now, tz), now - SPARK_DAYS * 86_400_000)
  return summarize(await loadEntries(since, homeDir), tz)
}

export async function piTable(tz: string, homeDir?: string): Promise<TableData> {
  return tabulate(await loadEntries(monthsAgoStart(Date.now(), 6, tz), homeDir), tz)
}
