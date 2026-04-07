import { readdir, stat as fsStat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AppData, UsageSummary, TableRow, ModelDetail } from './types'

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
      entries.push({
        ts,
        model: obj.message.model ?? 'unknown',
        cost: costOf(obj.message.model ?? '', u),
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

function groupBy(entries: Entry[], keyFn: (e: Entry) => string): TableRow[] {
  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    const key = keyFn(e)
    const arr = groups.get(key)
    if (arr) arr.push(e)
    else groups.set(key, [e])
  }

  const rows: TableRow[] = []
  for (const [label, group] of groups) {
    const models = [...new Set(group.map(e => shortModel(e.model)))]
    let input = 0, output = 0, cacheCreate = 0, cacheRead = 0, cost = 0
    for (const e of group) {
      input += e.input
      output += e.output
      cacheCreate += e.cacheCreate
      cacheRead += e.cacheRead
      cost += e.cost
    }

    const byModel = new Map<string, ModelDetail>()
    for (const e of group) {
      const name = shortModel(e.model)
      const m = byModel.get(name) ?? { name, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0 }
      m.input += e.input; m.output += e.output
      m.cacheCreate += e.cacheCreate; m.cacheRead += e.cacheRead
      m.cost += e.cost
      byModel.set(name, m)
    }

    rows.push({
      label, models: models.sort(),
      input, output, cacheCreate, cacheRead,
      total: input + output + cacheCreate + cacheRead, cost,
      breakdown: [...byModel.values()].sort((a, b) => b.cost - a.cost),
    })
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label))
}

function isoWeekLabel(ts: number): string {
  const d = new Date(ts)
  const day = d.getDay()
  const mondayOffset = day === 0 ? 6 : day - 1
  const monday = new Date(d)
  monday.setDate(d.getDate() - mondayOffset)
  return monday.toISOString().slice(0, 10)
}

function monthLabel(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7)
}

export interface DashboardData {
  today: UsageSummary
  week: UsageSummary
  month: UsageSummary
  burnRate: number
}

export interface TableData {
  daily: TableRow[]
  weekly: TableRow[]
  monthly: TableRow[]
}

export async function fetchDashboard(): Promise<DashboardData> {
  const d = new Date()
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const weekDay = d.getDay()
  const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (weekDay === 0 ? 6 : weekDay - 1)).getTime()

  const now = Date.now()
  const entries = await loadEntries(monthStart)
  const todayEntries = entries.filter(e => e.ts >= todayStart)

  let burnRate = 0
  if (todayEntries.length > 0) {
    const oldest = Math.min(...todayEntries.map(e => e.ts))
    const hrs = (now - oldest) / 3_600_000
    if (hrs > 0) burnRate = todayEntries.reduce((s, e) => s + e.cost, 0) / hrs
  }

  return {
    today: sum(todayEntries),
    week: sum(entries.filter(e => e.ts >= weekStart)),
    month: sum(entries.filter(e => e.ts >= monthStart)),
    burnRate,
  }
}

export async function fetchTable(): Promise<TableData> {
  const d = new Date()
  const lookback = new Date(d.getFullYear(), d.getMonth() - 6, 1).getTime()
  const entries = await loadEntries(lookback)

  return {
    daily: groupBy(entries, e => new Date(e.ts).toISOString().slice(0, 10)),
    weekly: groupBy(entries, e => isoWeekLabel(e.ts)),
    monthly: groupBy(entries, e => monthLabel(e.ts)),
  }
}
