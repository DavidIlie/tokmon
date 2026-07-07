import { readFile, stat as fsStat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, dashboardSince, tableSince, walkFiles } from '../usage-core'

const PRICING: Record<string, { in: number; out: number; cr: number }> = {
  'gemini-3.1-pro-preview': { in: 2e-6, out: 12e-6, cr: 0.2e-6 },
  'gemini-3.1-pro': { in: 2e-6, out: 12e-6, cr: 0.2e-6 },
  'gemini-3-pro-preview': { in: 2e-6, out: 12e-6, cr: 0.2e-6 },
  'gemini-3-pro': { in: 2e-6, out: 12e-6, cr: 0.2e-6 },
  'gemini-3.5-flash': { in: 1.5e-6, out: 9e-6, cr: 0.15e-6 },
  'gemini-3-flash-preview': { in: 0.5e-6, out: 3e-6, cr: 0.05e-6 },
  'gemini-3-flash': { in: 0.5e-6, out: 3e-6, cr: 0.05e-6 },
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

function entryFromObject(obj: any): Entry | null {
  if ((obj.sessionId && obj.kind) || obj.$set || obj.$rewindTo) return null
  if (obj.type !== 'gemini' || !obj.tokens) return null

  const ts = Date.parse(obj.timestamp ?? '')
  if (!Number.isFinite(ts)) return null

  const t = obj.tokens
  const input = Math.max(0, safeNum(t.input) + safeNum(t.tool) - safeNum(t.cached))
  const output = safeNum(t.output) + safeNum(t.thoughts)
  const cacheRead = safeNum(t.cached)
  if (input + output + cacheRead === 0) return null

  const model = typeof obj.model === 'string' && obj.model ? obj.model : 'unknown'
  const p = priceFor(model)
  return {
    id: typeof obj.id === 'string' ? obj.id : undefined,
    ts,
    model: shortModel(model),
    cost: input * p.in + cacheRead * p.cr + output * p.out,
    input,
    output,
    cacheCreate: 0,
    cacheRead,
    cacheSavings: cacheRead * (p.in - p.cr),
  }
}

function entriesFromJson(value: unknown): Entry[] {
  const entries: Entry[] = []
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item)
      return
    }
    if (!v || typeof v !== 'object') return
    const obj = v as Record<string, unknown>
    const entry = entryFromObject(obj)
    if (entry) {
      entries.push(entry)
      return
    }
    for (const key of ['events', 'messages', 'entries', 'records']) {
      const nested = obj[key]
      if (Array.isArray(nested)) visit(nested)
    }
  }
  visit(value)
  return entries
}

async function parseLineFile(path: string): Promise<Entry[]> {
  const entries: Entry[] = []
  const input = createReadStream(path)
  input.on('error', () => {})
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      try {
        const obj = JSON.parse(line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line)
        const entry = entryFromObject(obj)
        if (entry) entries.push(entry)
      } catch {}
    }
  } catch {}
  return entries
}

async function parseFile(path: string): Promise<Entry[]> {
  if (path.endsWith('.json')) {
    try {
      const raw = await readFile(path, 'utf-8')
      return entriesFromJson(JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw))
    } catch {}
  }
  return parseLineFile(path)
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const files: { path: string; mtimeMs: number; size: number }[] = []
  const seen = new Set<string>()
  const seenIno = new Set<string>()

  const root = geminiTmpDir(homeDir)
  const listing = await walkFiles(root)

  for (const f of listing) {
    if (!isGeminiSessionFile(f)) continue
    const path = join(root, f)
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
