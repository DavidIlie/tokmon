import { readdir, stat as fsStat, access, open as openFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { envDir } from '../../config'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, dashboardSince, tableSince } from '../usage-core'

const PRICING: Record<string, { in: number; cr: number; out: number }> = {
  'gpt-5.5-codex': { in: 5e-6, cr: 0.5e-6, out: 30e-6 },
  'gpt-5.5': { in: 5e-6, cr: 0.5e-6, out: 30e-6 },
  'gpt-5.4-codex': { in: 2.5e-6, cr: 0.25e-6, out: 15e-6 },
  'gpt-5.4': { in: 2.5e-6, cr: 0.25e-6, out: 15e-6 },
  'gpt-5-codex': { in: 1.25e-6, cr: 0.125e-6, out: 10e-6 },
  'gpt-5-mini': { in: 0.25e-6, cr: 0.025e-6, out: 2e-6 },
  'gpt-5-nano': { in: 0.05e-6, cr: 0.005e-6, out: 0.4e-6 },
  'gpt-5': { in: 1.25e-6, cr: 0.125e-6, out: 10e-6 },
  'o4-mini': { in: 1.1e-6, cr: 0.275e-6, out: 4.4e-6 },
}
const ZERO_PRICE = { in: 0, cr: 0, out: 0 }
const PRICE_KEYS = Object.keys(PRICING).sort((a, b) => b.length - a.length)

export function codexHomes(homeDir?: string): string[] {
  if (homeDir) return [...new Set([join(homeDir, '.codex'), homeDir])]
  const homes: string[] = []
  const codexHome = envDir('CODEX_HOME')
  if (codexHome) homes.push(codexHome)
  homes.push(join(homedir(), '.codex'))
  homes.push(join(homedir(), '.config', 'codex'))
  return [...new Set(homes)]
}

export async function detectCodex(homeDir?: string): Promise<boolean> {
  for (const home of codexHomes(homeDir)) {
    try { await access(join(home, 'sessions')); return true } catch {}
    try { await access(join(home, 'archived_sessions')); return true } catch {}
  }
  return false
}

function modelKeyMatches(model: string, key: string): boolean {
  let idx = model.indexOf(key)
  while (idx >= 0) {
    const before = idx === 0 ? '' : model[idx - 1]
    const rest = model.slice(idx + key.length)
    if ((!before || !/[a-z0-9-]/.test(before)) && (rest === '' || rest[0] === '-' || !/[a-z0-9]/.test(rest[0]))) {
      return true
    }
    idx = model.indexOf(key, idx + key.length)
  }
  return false
}

function priceFor(model: string) {
  const m = model.toLowerCase().trim()
  for (const key of PRICE_KEYS) {
    if (modelKeyMatches(m, key)) return PRICING[key]
  }
  return ZERO_PRICE
}

function extractModel(obj: any): string | null {
  const p = obj?.payload ?? obj
  return p?.model
    || p?.model_name
    || p?.collaboration_mode?.settings?.model
    || p?.model_slug
    || p?.config?.model
    || p?.info?.model
    || p?.info?.model_name
    || p?.info?.model_slug
    || p?.metadata?.model
    || p?.info?.metadata?.model
    || null
}

interface CodexDelta {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

function subtractClamped(cur: CodexDelta, prev: CodexDelta | null): CodexDelta {
  const sub = (a?: number, b?: number) => Math.max(0, (a ?? 0) - (b ?? 0))
  return {
    input_tokens: sub(cur.input_tokens, prev?.input_tokens),
    cached_input_tokens: sub(cur.cached_input_tokens, prev?.cached_input_tokens),
    output_tokens: sub(cur.output_tokens, prev?.output_tokens),
    reasoning_output_tokens: sub(cur.reasoning_output_tokens, prev?.reasoning_output_tokens),
    total_tokens: sub(cur.total_tokens, prev?.total_tokens),
  }
}

function tokenNumber(obj: any, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = obj?.[key]
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  return undefined
}

function normalizeUsage(obj: any): CodexDelta | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const input = tokenNumber(obj, ['input_tokens', 'prompt_tokens', 'input'])
  const cached = tokenNumber(obj, ['cached_input_tokens', 'cache_read_input_tokens', 'cached_tokens'])
  const output = tokenNumber(obj, ['output_tokens', 'completion_tokens', 'output'])
  const reasoning = tokenNumber(obj, ['reasoning_output_tokens', 'reasoning_tokens'])
  let total = tokenNumber(obj, ['total_tokens'])
  const hasUsage = [input, cached, output, reasoning, total].some(v => v !== undefined)
  if (!hasUsage) return undefined
  if (total === undefined || (total === 0 && (input ?? 0) + (output ?? 0) + (reasoning ?? 0) > 0)) {
    total = (input ?? 0) + (output ?? 0) + (reasoning ?? 0)
  }
  return {
    input_tokens: input ?? 0,
    cached_input_tokens: cached ?? 0,
    output_tokens: output ?? 0,
    reasoning_output_tokens: reasoning ?? 0,
    total_tokens: total,
  }
}

function eventSig(last: CodexDelta | undefined, total: CodexDelta | undefined): string {
  const f = (x: CodexDelta | undefined) =>
    x ? `${x.input_tokens ?? 0},${x.cached_input_tokens ?? 0},${x.output_tokens ?? 0},${x.reasoning_output_tokens ?? 0},${x.total_tokens ?? 0}` : '-'
  return `${f(last)}|${f(total)}`
}

function timestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000
  if (typeof value === 'string' && value.trim()) return new Date(value.trim()).getTime()
  return NaN
}

function timestampSecond(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length >= 19) return value.trim().slice(0, 19)
  const ts = timestampMs(value)
  return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 19) : null
}

async function hasThreadSpawn(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof openFile>> | null = null
  try {
    handle = await openFile(path, 'r')
    const buffer = Buffer.alloc(16 * 1024)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).includes('thread_spawn')
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function detectReplaySecond(path: string): Promise<string | null> {
  if (!(await hasThreadSpawn(path))) return null
  let first: string | null = null
  const input = createReadStream(path)
  input.on('error', () => {})
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const rawLine of rl) {
      if (!rawLine.includes('token_count')) continue
      try {
        const line = rawLine.charCodeAt(0) === 0xFEFF ? rawLine.slice(1) : rawLine
        const obj: any = JSON.parse(line)
        if ((obj?.payload?.type ?? obj?.type) !== 'token_count') continue
        const info = obj?.payload?.info
        if (!normalizeUsage(info?.last_token_usage) && !normalizeUsage(info?.total_token_usage)) continue
        const second = timestampSecond(obj.timestamp ?? obj?.payload?.timestamp)
        if (!second) continue
        if (!first) first = second
        else return first === second ? second : null
      } catch {}
    }
  } catch {}
  return null
}

function findUsage(obj: any): CodexDelta | undefined {
  return normalizeUsage(obj?.usage)
    ?? normalizeUsage(obj?.payload?.usage)
    ?? normalizeUsage(obj?.payload?.info?.usage)
    ?? normalizeUsage(obj?.result?.usage)
    ?? normalizeUsage(obj?.response?.usage)
    ?? normalizeUsage(obj?.token_usage)
    ?? normalizeUsage(obj)
}

function findTimestamp(obj: any): number {
  return timestampMs(obj?.timestamp ?? obj?.payload?.timestamp ?? obj?.created_at ?? obj?.createdAt ?? obj?.time)
}

async function parseFile(path: string): Promise<Entry[]> {
  const entries: Entry[] = []
  let model = 'gpt-5'
  let prevTotal: CodexDelta | null = null
  let prevSig: string | null = null
  const replaySecond = await detectReplaySecond(path)
  let skipReplay = replaySecond !== null
  const input = createReadStream(path)
  input.on('error', () => {})
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const rawLine of rl) {
      if (
        !rawLine.includes('token_count')
        && !rawLine.includes('turn_context')
        && !rawLine.includes('"usage"')
        && !rawLine.includes('input_tokens')
        && !rawLine.includes('prompt_tokens')
      ) continue
      try {
        const line = rawLine.charCodeAt(0) === 0xFEFF ? rawLine.slice(1) : rawLine
        const obj: any = JSON.parse(line)

        const payloadType = obj?.payload?.type ?? obj?.type
        if (payloadType === 'turn_context') {
          const m = extractModel(obj)
          if (typeof m === 'string' && m.trim()) model = m
          continue
        }
        if (payloadType !== 'token_count') {
          const usage = findUsage(obj)
          if (!usage) continue
          const m = extractModel(obj)
          if (typeof m === 'string' && m.trim()) model = m
          const ts = findTimestamp(obj)
          if (!Number.isFinite(ts)) continue
          const inputTotal = safeNum(usage.input_tokens)
          const cached = Math.min(safeNum(usage.cached_input_tokens), inputTotal)
          const inputTokens = inputTotal - cached
          const output = safeNum(usage.output_tokens)
          if (inputTokens + output + cached === 0) continue
          const p = priceFor(model)
          entries.push({
            id: `${ts}|${model}|${inputTotal}|${cached}|${output}|${safeNum(usage.reasoning_output_tokens)}|${safeNum(usage.total_tokens)}`,
            ts,
            model,
            cost: inputTokens * p.in + cached * p.cr + output * p.out,
            input: inputTokens,
            output,
            cacheCreate: 0,
            cacheRead: cached,
            cacheSavings: cached * (p.in - p.cr),
          })
          continue
        }

        const info = obj?.payload?.info
        const total = normalizeUsage(info?.total_token_usage)
        const last = normalizeUsage(info?.last_token_usage)
        const tsValue = obj.timestamp ?? obj?.payload?.timestamp
        if (skipReplay && replaySecond) {
          const second = timestampSecond(tsValue)
          if (second === replaySecond) {
            if (total) prevTotal = total
            continue
          }
          if (second) skipReplay = false
        }

        const sig = eventSig(last, total)
        if (sig === prevSig) continue
        prevSig = sig

        let d: CodexDelta | undefined = last
        if (!d && total) {
          const reset = !!prevTotal && (total.input_tokens ?? 0) < (prevTotal.input_tokens ?? 0)
          d = reset ? total : subtractClamped(total, prevTotal)
        }
        if (total) prevTotal = total
        if (!d) continue

        const ts = timestampMs(tsValue)
        if (!Number.isFinite(ts)) continue

        const m = extractModel(obj)
        if (typeof m === 'string' && m.trim()) model = m
        const inputTotal = safeNum(d.input_tokens)
        const cached = Math.min(safeNum(d.cached_input_tokens), inputTotal)
        const inputTokens = inputTotal - cached
        const output = safeNum(d.output_tokens)
        if (inputTokens + output + cached === 0) continue

        const p = priceFor(model)
        entries.push({
          id: `${ts}|${model}|${inputTotal}|${cached}|${output}|${safeNum(d.reasoning_output_tokens)}|${safeNum(d.total_tokens)}`,
          ts,
          model,
          cost: inputTokens * p.in + cached * p.cr + output * p.out,
          input: inputTokens,
          output,
          cacheCreate: 0,
          cacheRead: cached,
          cacheSavings: cached * (p.in - p.cr),
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

  for (const home of codexHomes(homeDir)) {
    for (const dir of [join(home, 'sessions'), join(home, 'archived_sessions')]) {
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
          if (s.ino && process.platform !== 'win32') {
            const idn = `${s.dev}:${s.ino}`
            if (seenIno.has(idn)) continue
            seenIno.add(idn)
          }
          files.push({ path, mtimeMs: s.mtimeMs, size: s.size })
        } catch {}
      }
    }
  }

  return loadCachedEntries(files, parseFile, since)
}

export async function codexDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  const entries = await loadEntries(dashboardSince(tz), homeDir)
  return summarize(entries, tz)
}

export async function codexTable(tz: string, homeDir?: string): Promise<TableData> {
  const entries = await loadEntries(tableSince(tz), homeDir)
  return tabulate(entries, tz)
}
