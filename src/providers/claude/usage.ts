import { stat as fsStat, access } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { envDir } from '../../config'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, dashboardSince, tableSince, hasFileMatching, walkFiles } from '../usage-core'
import { timestampMs } from '../_shared/time'

const PRICING: Record<string, { i: number; o: number; cc: number; cr: number }> = {
  'claude-opus-4-8': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-opus-4-7': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-opus-4-6': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-opus-4-5': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-opus-4-1': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4-0': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4-20250514': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-3-opus': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-sonnet-4': { i: 3e-6, o: 15e-6, cc: 3.75e-6, cr: 3e-7 },
  // intro pricing through 2026-08-31 — revert to 3/15/3.75/0.3 after.
  'claude-sonnet-5': { i: 2e-6, o: 10e-6, cc: 2.5e-6, cr: 2e-7 },
  'claude-haiku-4': { i: 1e-6, o: 5e-6, cc: 1.25e-6, cr: 1e-7 },
  'claude-fable-5': { i: 10e-6, o: 50e-6, cc: 12.5e-6, cr: 1e-6 },
}
const PRICE_KEYS = Object.keys(PRICING).sort((a, b) => b.length - a.length)
const ZERO_PRICE = { i: 0, o: 0, cc: 0, cr: 0 }
const SONNET_5_STANDARD_FROM = Date.UTC(2026, 8, 1)
const SONNET_5_STANDARD_PRICE = { i: 3e-6, o: 15e-6, cc: 3.75e-6, cr: 3e-7 }

export function claudeConfigDirs(homeDir?: string): string[] {
  if (homeDir) {
    return [join(homeDir, '.claude'), join(homeDir, '.config', 'claude')]
  }
  const home = homedir()
  const dirs = [join(home, '.claude')]
  const xdg = envDir('XDG_CONFIG_HOME')
  if (xdg) {
    dirs.push(join(xdg, 'claude'))
  }
  if (process.platform !== 'win32') {
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

/** What counts as evidence of a Claude session on disk. */
export const isClaudeSessionFile = (name: string): boolean => name.endsWith('.jsonl')

export async function detectClaude(homeDir?: string): Promise<boolean> {
  for (const configDir of claudeConfigDirs(homeDir)) {
    try { await access(join(configDir, '.credentials.json')); return true } catch {}
  }
  for (const dir of getClaudeDirs(homeDir)) {
    // Keychain-only homes always reach here, and this runs at daemon start and
    // on every engine-affecting config save, so it stops at the first session
    // file rather than collecting the tree first.
    try {
      if (await hasFileMatching(dir, isClaudeSessionFile)) return true
    } catch {}
  }
  return false
}

export function claudePriceFor(model: string, timestamp = Date.now()) {
  // Strip a trailing context-window tag (e.g. the `[1m]` long-context suffix) so
  // 'claude-opus-4-8[1m]' prices the same as 'claude-opus-4-8' instead of falling
  // through to a shorter legacy key (overcharge) or matching nothing (zero price).
  const m = model.toLowerCase().trim().replace(/\[[^\]]*\]$/, '')
  for (const key of PRICE_KEYS) {
    if (!m.startsWith(key)) continue
    const rest = m.slice(key.length)
    if (rest === '' || rest[0] === '-') {
      if (key === 'claude-sonnet-5' && timestamp >= SONNET_5_STANDARD_FROM) return SONNET_5_STANDARD_PRICE
      return PRICING[key]
    }
  }
  return ZERO_PRICE
}

interface UsageTokens {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  } | null
}

function costOf(model: string, u: UsageTokens, cacheCreate5m: number, cacheCreate1h: number, hasCacheCreateSplit: boolean, timestamp: number): number {
  const p = claudePriceFor(model, timestamp)
  const cacheCreateCost = hasCacheCreateSplit
    ? cacheCreate5m * p.cc + cacheCreate1h * (2 * p.i)
    : safeNum(u.cache_creation_input_tokens) * p.cc
  return safeNum(u.input_tokens) * p.i
    + safeNum(u.output_tokens) * p.o
    + cacheCreateCost
    + safeNum(u.cache_read_input_tokens) * p.cr
}

function shortModel(model: string): string {
  return model.replace('claude-', '').replace(/-\d{8}$/, '')
}

async function parseFile(path: string): Promise<Entry[]> {
  const entries: Entry[] = []
  const input = createReadStream(path)
  input.on('error', () => {})
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (!line.includes('"usage"')) continue
      try {
        const obj = JSON.parse(line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line)
        if (obj.type !== 'assistant' || !obj.message?.usage) continue
        const ts = timestampMs(obj.timestamp)
        if (ts === null) continue
        const u = obj.message.usage
        const model = typeof obj.message.model === 'string' && obj.message.model ? obj.message.model : 'unknown'
        const inputTokens = safeNum(u.input_tokens)
        const output = safeNum(u.output_tokens)
        const hasCacheCreateSplit = u.cache_creation?.ephemeral_5m_input_tokens !== undefined
          || u.cache_creation?.ephemeral_1h_input_tokens !== undefined
        const cacheCreate5m = safeNum(u.cache_creation?.ephemeral_5m_input_tokens)
        const cacheCreate1h = safeNum(u.cache_creation?.ephemeral_1h_input_tokens)
        const cacheCreate = hasCacheCreateSplit ? cacheCreate5m + cacheCreate1h : safeNum(u.cache_creation_input_tokens)
        const cacheRead = safeNum(u.cache_read_input_tokens)
        if (inputTokens + output + cacheCreate + cacheRead === 0) continue
        const p = claudePriceFor(model, ts)
        const msgId = obj.message?.id
        entries.push({
          id: msgId ? msgId + (obj.requestId ? ':' + obj.requestId : '') : undefined,
          ts,
          model: shortModel(model),
          cost: costOf(model, u, cacheCreate5m, cacheCreate1h, hasCacheCreateSplit, ts),
          input: inputTokens,
          output,
          cacheCreate,
          cacheRead,
          cacheSavings: cacheRead * (p.i - p.cr),
        })
      } catch {}
    }
  } catch {}
  return entries
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const files: { path: string; mtimeMs: number; size: number }[] = []
  const seen = new Set<string>()
  const seenIno = new Set<string>()

  for (const dir of getClaudeDirs(homeDir)) {
    const listing = await walkFiles(dir)
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
