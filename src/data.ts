import { readdir, stat as fsStat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { minutes } from './format'
import type { AppData, UsageSummary, DailyRow } from './types'

const PRICING: Record<string, { i: number; o: number; cc: number; cr: number }> = {
  'claude-opus-4': { i: 5e-6, o: 25e-6, cc: 6.25e-6, cr: 5e-7 },
  'claude-sonnet-4': { i: 3e-6, o: 15e-6, cc: 3.75e-6, cr: 3e-7 },
  'claude-haiku-4': { i: 1e-6, o: 5e-6, cc: 1.25e-6, cr: 1e-7 },
}

const FALLBACK = PRICING['claude-opus-4']

interface Entry {
  ts: number
  model: string
  cost: number
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
}

const fileCache = new Map<string, { mtimeMs: number; data: Entry[] }>()

function getClaudeDirs(): string[] {
  const home = homedir()
  const dirs = [join(home, '.claude', 'projects')]
  if (process.env.XDG_CONFIG_HOME) {
    dirs.push(join(process.env.XDG_CONFIG_HOME, 'claude', 'projects'))
  } else if (process.platform !== 'win32') {
    dirs.push(join(home, '.config', 'claude', 'projects'))
  }
  if (process.env.APPDATA) {
    dirs.push(join(process.env.APPDATA, 'claude', 'projects'))
  }
  if (process.env.CLAUDE_CONFIG_DIR) {
    for (const p of process.env.CLAUDE_CONFIG_DIR.split(process.platform === 'win32' ? ';' : ',')) {
      dirs.push(join(p.trim(), 'projects'))
    }
  }
  return dirs
}

function priceFor(model: string) {
  for (const [prefix, p] of Object.entries(PRICING)) {
    if (model.startsWith(prefix)) return p
  }
  return FALLBACK
}

function costOf(model: string, u: Record<string, number>): number {
  const p = priceFor(model)
  return (u.input_tokens ?? 0) * p.i
    + (u.output_tokens ?? 0) * p.o
    + (u.cache_creation_input_tokens ?? 0) * p.cc
    + (u.cache_read_input_tokens ?? 0) * p.cr
}

function shortModel(model: string): string {
  return model
    .replace('claude-', '')
    .replace('-20251001', '')
    .replace('-20250514', '')
    .replace('-20251101', '')
    .replace('-20250805', '')
}

async function parseFile(path: string, since: number): Promise<Entry[]> {
  const entries: Entry[] = []
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue
    try {
      const obj = JSON.parse(line)
      if (obj.type !== 'assistant' || !obj.message?.usage) continue
      const ts = new Date(obj.timestamp ?? 0).getTime()
      if (ts < since) continue
      const u = obj.message.usage
      const model = obj.message.model ?? 'unknown'
      entries.push({
        ts,
        model,
        cost: costOf(model, u),
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheCreate: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
      })
    } catch { /* skip malformed lines */ }
  }
  return entries
}

async function loadEntries(since: number): Promise<Entry[]> {
  const all: Entry[] = []
  const seen = new Set<string>()

  for (const dir of getClaudeDirs()) {
    let listing: string[]
    try {
      listing = await readdir(dir, { recursive: true })
    } catch {
      continue
    }

    const files = listing.filter(f => f.endsWith('.jsonl'))

    await Promise.all(files.map(async (f) => {
      const path = join(dir, f)
      if (seen.has(path)) return
      seen.add(path)
      try {
        const s = await fsStat(path)
        if (s.mtimeMs < since) return

        const cached = fileCache.get(path)
        if (cached && cached.mtimeMs === s.mtimeMs) {
          all.push(...cached.data)
          return
        }

        const data = await parseFile(path, since)
        fileCache.set(path, { mtimeMs: s.mtimeMs, data })
        all.push(...data)
      } catch { /* skip inaccessible files */ }
    }))
  }

  return all
}

function sum(entries: Entry[]): UsageSummary {
  let cost = 0, tokens = 0
  for (const e of entries) {
    cost += e.cost
    tokens += e.input + e.output + e.cacheCreate + e.cacheRead
  }
  return { cost, tokens }
}

function buildDaily(entries: Entry[]): DailyRow[] {
  const byDate = new Map<string, Entry[]>()
  for (const e of entries) {
    const date = new Date(e.ts).toISOString().slice(0, 10)
    const arr = byDate.get(date)
    if (arr) arr.push(e)
    else byDate.set(date, [e])
  }

  const rows: DailyRow[] = []
  for (const [date, dayEntries] of byDate) {
    const models = [...new Set(dayEntries.map(e => shortModel(e.model)))]
    let input = 0, output = 0, cacheCreate = 0, cacheRead = 0, cost = 0
    for (const e of dayEntries) {
      input += e.input
      output += e.output
      cacheCreate += e.cacheCreate
      cacheRead += e.cacheRead
      cost += e.cost
    }
    rows.push({
      date,
      models: models.sort(),
      input, output, cacheCreate, cacheRead,
      total: input + output + cacheCreate + cacheRead,
      cost,
    })
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchData(): Promise<AppData> {
  const now = Date.now()
  const d = new Date()
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const weekDay = d.getDay()
  const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (weekDay === 0 ? 6 : weekDay - 1)).getTime()

  const entries = await loadEntries(monthStart)

  const fiveHoursAgo = now - 5 * 3_600_000
  const blockEntries = entries.filter(e => e.ts >= fiveHoursAgo)

  let block: AppData['block'] = null
  if (blockEntries.length > 0) {
    const spent = blockEntries.reduce((s, e) => s + e.cost, 0)
    const oldest = Math.min(...blockEntries.map(e => e.ts))
    const elapsedHrs = (now - oldest) / 3_600_000
    const burnRate = elapsedHrs > 0 ? spent / elapsedHrs : 0
    const remainMs = Math.max(0, oldest + 5 * 3_600_000 - now)
    const percent = Math.min(100, ((now - oldest) / (5 * 3_600_000)) * 100)

    block = { spent, projected: burnRate * 5, burnRate, percent, remaining: minutes(remainMs / 60_000) }
  }

  return {
    today: sum(entries.filter(e => e.ts >= todayStart)),
    week: sum(entries.filter(e => e.ts >= weekStart)),
    month: sum(entries),
    block,
    daily: buildDaily(entries),
  }
}
