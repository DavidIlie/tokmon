import { readdir, stat as fsStat, access } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { envDir } from '../../config'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, dashboardSince, tableSince } from '../usage-core'

const PRICING: Record<string, { i: number; o: number; cc: number; cr: number }> = {
  'claude-opus-4-1': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4-0': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4-20250514': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-3-opus': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-sonnet-4': { i: 3e-6, o: 15e-6, cc: 3.75e-6, cr: 3e-7 },
  'claude-haiku-4': { i: 1e-6, o: 5e-6, cc: 1.25e-6, cr: 1e-7 },
  'claude-fable-5': { i: 10e-6, o: 50e-6, cc: 12.5e-6, cr: 1e-6 },
}
const PRICE_KEYS = Object.keys(PRICING).sort((a, b) => b.length - a.length)
const ZERO_PRICE = { i: 0, o: 0, cc: 0, cr: 0 }

export function claudeConfigDirs(homeDir?: string): string[] {
  if (homeDir) {
    return [join(homeDir, '.claude'), join(homeDir, '.config', 'claude')]
  }
  const home = homedir()
  const dirs = [join(home, '.claude')]
  const xdg = envDir('XDG_CONFIG_HOME')
  if (xdg) {
    dirs.push(join(xdg, 'claude'))
  } else if (process.platform !== 'win32') {
    dirs.push(join(home, '.config', 'claude'))
  }
  const appData = envDir('APPDATA')
  if (appData) dirs.push(join(appData, 'claude'))
  if (process.env.CLAUDE_CONFIG_DIR) {
    for (const p of process.env.CLAUDE_CONFIG_DIR.split(process.platform === 'win32' ? ';' : ',')) {
      const t = p.trim()
      if (t && isAbsolute(t)) dirs.push(t)
    }
  }
  return [...new Set(dirs)]
}

function getClaudeDirs(homeDir?: string): string[] {
  return claudeConfigDirs(homeDir).map(d => join(d, 'projects'))
}

export async function detectClaude(homeDir?: string): Promise<boolean> {
  for (const dir of getClaudeDirs(homeDir)) {
    try { await access(dir); return true } catch {}
  }
  return false
}

function priceFor(model: string) {
  const m = model.toLowerCase().trim()
  for (const key of PRICE_KEYS) {
    if (!m.startsWith(key)) continue
    const rest = m.slice(key.length)
    if (rest === '' || rest[0] === '-') return PRICING[key]
  }
  return ZERO_PRICE
}

interface UsageTokens {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

function costOf(model: string, u: UsageTokens): number {
  const p = priceFor(model)
  return safeNum(u.input_tokens) * p.i
    + safeNum(u.output_tokens) * p.o
    + safeNum(u.cache_creation_input_tokens) * p.cc
    + safeNum(u.cache_read_input_tokens) * p.cr
}

function shortModel(model: string): string {
  return model.replace('claude-', '').replace(/-\d{8}$/, '')
}

async function parseFile(path: string): Promise<Entry[]> {
  const entries: Entry[] = []
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue
    try {
      const obj = JSON.parse(line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line)
      if (obj.type !== 'assistant' || !obj.message?.usage) continue
      const ts = new Date(obj.timestamp ?? 0).getTime()
      if (!Number.isFinite(ts)) continue
      const u = obj.message.usage
      const model = typeof obj.message.model === 'string' && obj.message.model ? obj.message.model : 'unknown'
      const input = safeNum(u.input_tokens)
      const output = safeNum(u.output_tokens)
      const cacheCreate = safeNum(u.cache_creation_input_tokens)
      const cacheRead = safeNum(u.cache_read_input_tokens)
      if (input + output + cacheCreate + cacheRead === 0) continue
      const p = priceFor(model)
      const msgId = obj.message?.id
      entries.push({
        id: msgId ? msgId + (obj.requestId ? ':' + obj.requestId : '') : undefined,
        ts,
        model: shortModel(model),
        cost: costOf(model, u),
        input,
        output,
        cacheCreate,
        cacheRead,
        cacheSavings: cacheRead * (p.i - p.cr),
      })
    } catch {}
  }
  return entries
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const files: { path: string; mtimeMs: number; size: number }[] = []
  const seen = new Set<string>()
  const seenIno = new Set<string>()

  for (const dir of getClaudeDirs(homeDir)) {
    let listing: string[]
    try {
      listing = await readdir(dir, { recursive: true })
    } catch {
      continue
    }
    for (const f of listing) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(dir, f)
      if (seen.has(path)) continue
      seen.add(path)
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
  }

  return loadCachedEntries(files, parseFile, since)
}

export async function claudeDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  const entries = await loadEntries(dashboardSince(tz), homeDir)
  return summarize(entries, tz)
}

export async function claudeTable(tz: string, homeDir?: string): Promise<TableData> {
  const entries = await loadEntries(tableSince(tz), homeDir)
  return tabulate(entries, tz)
}
