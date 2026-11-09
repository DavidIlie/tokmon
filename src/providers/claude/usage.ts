import { access } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { envDir } from '../../config'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, dashboardSince, tableSince, hasFileMatching, collectSessionFiles } from '../usage-core'
import { readJsonLines } from '../_shared/jsonl'
import { makePriceResolver } from '../_shared/pricing'
import { timestampMs } from '../_shared/time'

// USD per token, from https://platform.claude.com/docs/en/about-claude/pricing
// (checked 2026-11-09). `cc` is the 5-minute cache write; a 1-hour write is 2x input.
const PRICING: Record<string, { i: number; o: number; cc: number; cr: number }> = {
  'claude-fable-5-2': { i: 8e-6, o: 40e-6, cc: 10e-6, cr: 0.2e-6 },
  'claude-mythos-5-2': { i: 8e-6, o: 40e-6, cc: 10e-6, cr: 0.2e-6 },
  'claude-fable-5-1': { i: 10e-6, o: 50e-6, cc: 12.5e-6, cr: 0.25e-6 },
  'claude-mythos-5-1': { i: 10e-6, o: 50e-6, cc: 12.5e-6, cr: 0.25e-6 },
  'claude-fable-5': { i: 10e-6, o: 50e-6, cc: 12.5e-6, cr: 1e-6 },
  'claude-mythos-5': { i: 10e-6, o: 50e-6, cc: 12.5e-6, cr: 1e-6 },
  'claude-opus-5-5': { i: 4e-6, o: 20e-6, cc: 5e-6, cr: 0.2e-6 },
  'claude-opus-5': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-opus-4-8': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-opus-4-7': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-opus-4-6': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-opus-4-5': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-opus-4-1': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4-0': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4-20250514': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-opus-4': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-3-opus': { i: 15e-6, o: 75e-6, cc: 18.75e-6, cr: 1.5e-6 },
  'claude-sonnet-5-5': { i: 2e-6, o: 10e-6, cc: 2.5e-6, cr: 0.1e-6 },
  // The launch price became the standard price; the September increase never happened.
  'claude-sonnet-5': { i: 2e-6, o: 10e-6, cc: 2.5e-6, cr: 2e-7 },
  'claude-sonnet-4': { i: 3e-6, o: 15e-6, cc: 3.75e-6, cr: 3e-7 },
  'claude-haiku-5-5': { i: 0.1e-6, o: 0.5e-6, cc: 0.125e-6, cr: 0.01e-6 },
  'claude-haiku-4': { i: 1e-6, o: 5e-6, cc: 1.25e-6, cr: 1e-7 },
}
// Unknown models use the current flagship rate so new releases are never silently free.
const resolvePrice = makePriceResolver(PRICING, { fallback: PRICING['claude-fable-5-2'] })
// Haiku 5.5 bills a whole request at the higher tier once its prompt passes 100k tokens.
const HAIKU_5_5_LONG_PROMPT = 100_000
const HAIKU_5_5_LONG_PRICE = { i: 0.5e-6, o: 2.5e-6, cc: 0.625e-6, cr: 0.05e-6 }

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

// Fast mode (`/fast`) reruns the same model at a flat multiplier on every token
// class, across the full context window. The transcript marks it per message in
// usage.speed; ignoring it undercounts fast sessions by the whole multiplier.
const FAST_MODE_MULTIPLIER = 2

export function claudePriceFor(model: string, _timestamp = Date.now(), speed?: string, promptTokens = 0) {
  // Strip a trailing context-window tag (e.g. the `[1m]` long-context suffix) so
  // 'claude-opus-4-8[1m]' prices the same as 'claude-opus-4-8' instead of falling
  // through to a shorter legacy key (overcharge) or the flagship fallback.
  let m = model.toLowerCase().trim().replace(/\[[^\]]*\]$/, '')
  // Proxies and aliases drop the vendor prefix ('fable-5-2').
  if (/^(fable|mythos|opus|sonnet|haiku)-/.test(m)) m = `claude-${m}`
  const base = (m === 'claude-haiku-5-5' || m.startsWith('claude-haiku-5-5-')) && promptTokens > HAIKU_5_5_LONG_PROMPT
    ? HAIKU_5_5_LONG_PRICE
    : resolvePrice(m)
  if (speed !== 'fast') return base
  return { i: base.i * FAST_MODE_MULTIPLIER, o: base.o * FAST_MODE_MULTIPLIER, cc: base.cc * FAST_MODE_MULTIPLIER, cr: base.cr * FAST_MODE_MULTIPLIER }
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
  /** 'fast' when the message ran under /fast mode; 'standard' or absent otherwise. */
  speed?: string
}

function costOf(model: string, u: UsageTokens, cacheCreate5m: number, cacheCreate1h: number, hasCacheCreateSplit: boolean, timestamp: number): number {
  const prompt = safeNum(u.input_tokens) + safeNum(u.cache_creation_input_tokens) + safeNum(u.cache_read_input_tokens)
  const p = claudePriceFor(model, timestamp, typeof u.speed === 'string' ? u.speed : undefined, prompt)
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

// Each transcript line prices on its own, so a byte range parses independently.
async function parseFile(path: string, start?: number, end?: number): Promise<Entry[]> {
  const entries: Entry[] = []
  for await (const obj of readJsonLines(path, line => line.includes('"usage"'), { start, end })) {
    try {
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
      const speed = typeof u.speed === 'string' ? u.speed : undefined
      const p = claudePriceFor(model, ts, speed, inputTokens + cacheCreate + cacheRead)
      const msgId = obj.message?.id
      entries.push({
        id: msgId ? msgId + (obj.requestId ? ':' + obj.requestId : '') : undefined,
        ts,
        // Fast-mode turns bill differently; keep them a distinct model row so
        // per-model tables reconcile against the invoice instead of blending.
        model: speed === 'fast' ? `${shortModel(model)} (fast)` : shortModel(model),
        cost: costOf(model, u, cacheCreate5m, cacheCreate1h, hasCacheCreateSplit, ts),
        input: inputTokens,
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
  const files = await collectSessionFiles(getClaudeDirs(homeDir), path => path.endsWith('.jsonl'), since)
  return loadCachedEntries(files, path => parseFile(path), since, { parseRange: parseFile })
}

export async function claudeDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  const entries = await loadEntries(dashboardSince(tz), homeDir)
  return summarize(entries, tz)
}

export async function claudeTable(tz: string, homeDir?: string): Promise<TableData> {
  const entries = await loadEntries(tableSince(tz), homeDir)
  return tabulate(entries, tz)
}
