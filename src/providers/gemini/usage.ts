import { readFile, stat as fsStat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, dashboardSince, tableSince, collectSessionFiles } from '../usage-core'
import { readJsonLines, stripBom } from '../_shared/jsonl'
import { makePriceResolver } from '../_shared/pricing'

type Price = { in: number; out: number; cr: number }
// `long` is the >200k-prompt-token tier for models that publish long-context
// pricing; it is selected uniformly in geminiPriceFor when promptTokens > 200_000.
const PRICING: Record<string, Price & { long?: Price }> = {
  'gemini-3.1-pro-preview': { in: 2e-6, out: 12e-6, cr: 0.2e-6, long: { in: 4e-6, out: 18e-6, cr: 0.4e-6 } },
  'gemini-3.1-pro': { in: 2e-6, out: 12e-6, cr: 0.2e-6, long: { in: 4e-6, out: 18e-6, cr: 0.4e-6 } },
  'gemini-3-pro-preview': { in: 2e-6, out: 12e-6, cr: 0.2e-6, long: { in: 4e-6, out: 18e-6, cr: 0.4e-6 } },
  'gemini-3-pro': { in: 2e-6, out: 12e-6, cr: 0.2e-6, long: { in: 4e-6, out: 18e-6, cr: 0.4e-6 } },
  'gemini-3.5-flash': { in: 0.75e-6, out: 4.5e-6, cr: 0.075e-6 },
  'gemini-3-flash-preview': { in: 0.5e-6, out: 3e-6, cr: 0.05e-6 },
  'gemini-3-flash': { in: 0.5e-6, out: 3e-6, cr: 0.05e-6 },
  'gemini-2.5-flash-lite': { in: 0.1e-6, out: 0.4e-6, cr: 0.01e-6 },
  'gemini-3.1-flash-lite': { in: 0.25e-6, out: 1.5e-6, cr: 0.025e-6 },
  'gemini-2.5-flash': { in: 0.3e-6, out: 2.5e-6, cr: 0.03e-6 },
  'gemini-2.5-pro': { in: 1.25e-6, out: 10e-6, cr: 0.125e-6, long: { in: 2.5e-6, out: 15e-6, cr: 0.25e-6 } },
  'gemini-2.0-flash': { in: 0.1e-6, out: 0.4e-6, cr: 0.025e-6 },
}
// Unknown/new Gemini models are priced at the current flagship pro rate rather
// than $0 — a slightly-wrong estimate beats silently free usage when Google
// ships a model this table doesn't know yet.
const FALLBACK_PRICE = PRICING['gemini-3.1-pro']
const resolvePrice = makePriceResolver(PRICING, { fallback: FALLBACK_PRICE })
const MAX_SESSION_FILE_BYTES = 16 * 1024 * 1024
const MAX_JSON_ENTRIES = 100_000

export function geminiTmpDir(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.gemini', 'tmp')
}

export function geminiPriceFor(model: string, promptTokens = 0): Price {
  const p = resolvePrice(model)
  if (promptTokens > 200_000 && p.long) return p.long
  return { in: p.in, out: p.out, cr: p.cr }
}

function shortModel(model: string): string {
  return model.replace(/(-preview|-customtools)+$/, '')
}

export function isGeminiSessionFile(path: string): boolean {
  return /(^|[\\/])chats[\\/]session-.*\.jsonl$/.test(path)
    || /(^|[\\/])chats[\\/]session-.*\.json$/.test(path)
}

function entryFromObject(obj: any): Entry | null {
  if ((obj.sessionId && obj.kind) || obj.$set || obj.$rewindTo) return null
  if (obj.type !== 'gemini' || !obj.tokens) return null

  const ts = Date.parse(obj.timestamp ?? '')
  if (!Number.isFinite(ts)) return null

  const t = obj.tokens
  const promptTokens = safeNum(t.input) + safeNum(t.tool)
  const input = Math.max(0, promptTokens - safeNum(t.cached))
  const output = safeNum(t.output) + safeNum(t.thoughts)
  const cacheRead = safeNum(t.cached)
  if (input + output + cacheRead === 0) return null

  const model = typeof obj.model === 'string' && obj.model ? obj.model : 'unknown'
  const p = geminiPriceFor(model, promptTokens)
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
    if (entries.length >= MAX_JSON_ENTRIES) return
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
  for await (const obj of readJsonLines(path)) {
    try {
      const entry = entryFromObject(obj)
      if (entry) entries.push(entry)
    } catch {}
  }
  return entries
}

async function parseFile(path: string): Promise<Entry[]> {
  if (path.endsWith('.json')) {
    try {
      if ((await fsStat(path)).size > MAX_SESSION_FILE_BYTES) return []
      const raw = await readFile(path, 'utf-8')
      return entriesFromJson(JSON.parse(stripBom(raw)))
    } catch {}
  }
  return parseLineFile(path)
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const root = geminiTmpDir(homeDir)
  const files = await collectSessionFiles([root], isGeminiSessionFile, since)
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
