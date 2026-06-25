import { readdir, stat as fsStat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, dashboardSince, tableSince } from '../usage-core'

const PRICING: Record<string, { in: number; out: number; cr: number }> = {
  'gemini-3.1-pro-preview': { in: 2e-6, out: 12e-6, cr: 0.2e-6 },
  'gemini-3.1-pro': { in: 2e-6, out: 12e-6, cr: 0.2e-6 },
  'gemini-3-pro-preview': { in: 2e-6, out: 12e-6, cr: 0.2e-6 },
  'gemini-3-pro': { in: 2e-6, out: 12e-6, cr: 0.2e-6 },
  'gemini-3.5-flash': { in: 1.5e-6, out: 9e-6, cr: 0.15e-6 },
  'gemini-3-flash-preview': { in: 1.5e-6, out: 9e-6, cr: 0.15e-6 },
  'gemini-3-flash': { in: 1.5e-6, out: 9e-6, cr: 0.15e-6 },
  'gemini-2.5-flash-lite': { in: 0.1e-6, out: 0.4e-6, cr: 0.01e-6 },
  'gemini-3.1-flash-lite': { in: 0.1e-6, out: 0.4e-6, cr: 0.01e-6 },
  'gemini-2.5-flash': { in: 0.3e-6, out: 2.5e-6, cr: 0.03e-6 },
  'gemini-2.5-pro': { in: 1.25e-6, out: 10e-6, cr: 0.125e-6 },
  'gemini-2.0-flash': { in: 0.1e-6, out: 0.4e-6, cr: 0.025e-6 },
}
const PRICE_KEYS = Object.keys(PRICING).sort((a, b) => b.length - a.length)
const ZERO_PRICE = { in: 0, out: 0, cr: 0 }

export function geminiTmpDir(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.gemini', 'tmp')
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

function shortModel(model: string): string {
  return model.replace(/(-preview|-customtools)+$/, '')
}

function isGeminiSessionFile(path: string): boolean {
  return /(^|[\\/])chats[\\/]session-.*\.jsonl$/.test(path)
    || /(^|[\\/])chats[\\/]session-.*\.json$/.test(path)
}

async function parseFile(path: string): Promise<Entry[]> {
  const entries: Entry[] = []
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of rl) {
    try {
      const obj = JSON.parse(line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line)
      if ((obj.sessionId && obj.kind) || obj.$set || obj.$rewindTo) continue
      if (obj.type !== 'gemini' || !obj.tokens) continue

      const ts = Date.parse(obj.timestamp ?? '')
      if (!Number.isFinite(ts)) continue

      const t = obj.tokens
      const input = Math.max(0, safeNum(t.input) + safeNum(t.tool) - safeNum(t.cached))
      const output = safeNum(t.output) + safeNum(t.thoughts)
      const cacheRead = safeNum(t.cached)
      if (input + output + cacheRead === 0) continue

      const model = typeof obj.model === 'string' && obj.model ? obj.model : 'unknown'
      const p = priceFor(model)
      entries.push({
        id: typeof obj.id === 'string' ? obj.id : undefined,
        ts,
        model: shortModel(model),
        cost: input * p.in + cacheRead * p.cr + output * p.out,
        input,
        output,
        cacheCreate: 0,
        cacheRead,
        cacheSavings: cacheRead * (p.in - p.cr),
      })
    } catch {}
  }
  return entries
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const files: { path: string; mtimeMs: number; size: number }[] = []
  const seen = new Set<string>()
  const seenIno = new Set<string>()

  let listing: string[]
  try {
    listing = await readdir(geminiTmpDir(homeDir), { recursive: true })
  } catch {
    return []
  }

  for (const f of listing) {
    if (!isGeminiSessionFile(f)) continue
    const path = join(geminiTmpDir(homeDir), f)
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

  return loadCachedEntries(files, parseFile, since)
}

export async function geminiDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  const entries = await loadEntries(dashboardSince(tz), homeDir)
  return summarize(entries, tz)
}

export async function geminiTable(tz: string, homeDir?: string): Promise<TableData> {
  const entries = await loadEntries(tableSince(tz), homeDir)
  return tabulate(entries, tz)
}
