import { access, readdir, readFile, stat as fsStat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { DashboardData, TableData } from '../../types'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, dashboardSince, tableSince } from '../usage-core'
import { grokHomes } from './identity'

// Per-token USD. Source: https://docs.x.ai/docs/models + per-model cached rates.
// `grok-build-latest` is an alias of grok-4.5 ($2/$6), NOT grok-build-0.1 ($1/$2).
const PRICING: Record<string, { in: number; cr: number; out: number }> = {
  'grok-build-latest': { in: 2e-6, cr: 0.5e-6, out: 6e-6 },
  'grok-4.5': { in: 2e-6, cr: 0.5e-6, out: 6e-6 },
  'grok-composer-2.5-fast': { in: 2e-6, cr: 0.5e-6, out: 6e-6 },
  'grok-4.3': { in: 1.25e-6, cr: 0.2e-6, out: 2.5e-6 },
  'grok-4.20': { in: 1.25e-6, cr: 0.2e-6, out: 2.5e-6 },
  'grok-build-0.1': { in: 1e-6, cr: 0.2e-6, out: 2e-6 },
  'grok-code-fast-1': { in: 1e-6, cr: 0.2e-6, out: 2e-6 },
  'grok-code-fast': { in: 1e-6, cr: 0.2e-6, out: 2e-6 },
  'grok-build': { in: 1e-6, cr: 0.2e-6, out: 2e-6 },
}
const FALLBACK_PRICE = PRICING['grok-4.5']
const PRICE_KEYS = Object.keys(PRICING).sort((a, b) => b.length - a.length)
const MAX_SESSION_GROUPS = 128
const MAX_SESSIONS_PER_GROUP = 512
const MAX_MODEL_FINGERPRINT_ENTRIES = MAX_SESSION_GROUPS * MAX_SESSIONS_PER_GROUP * 2

function modelKeyMatches(model: string, key: string): boolean {
  let idx = model.indexOf(key)
  while (idx >= 0) {
    const before = idx === 0 ? '' : model[idx - 1]
    const rest = model.slice(idx + key.length)
    const versionContinues = rest[0] === '.' && /\d/.test(rest[1] ?? '')
    if ((!before || !/[a-z0-9-]/.test(before)) && !versionContinues && (rest === '' || rest[0] === '-' || !/[a-z0-9]/.test(rest[0]))) {
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
  return FALLBACK_PRICE
}

export async function detectGrok(homeDir?: string): Promise<boolean> {
  for (const home of grokHomes(homeDir)) {
    for (const p of [join(home, 'logs', 'unified.jsonl'), join(home, 'sessions'), join(home, 'auth.json'), join(home, 'bin', 'grok')]) {
      try { await access(p); return true } catch { /* next */ }
    }
  }
  return false
}

async function loadSessionModels(home: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const sessionsRoot = join(home, 'sessions')
  let groups: string[]
  try { groups = await readdir(sessionsRoot) } catch { return out }
  for (const group of groups.sort().reverse().slice(0, MAX_SESSION_GROUPS)) {
    if (group === 'session_search.sqlite' || group.startsWith('.')) continue
    const groupDir = join(sessionsRoot, group)
    let sessions: string[]
    try { sessions = await readdir(groupDir) } catch { continue }
    for (const sid of sessions.sort().reverse().slice(0, MAX_SESSIONS_PER_GROUP)) {
      try {
        const raw = JSON.parse(await readFile(join(groupDir, sid, 'summary.json'), 'utf-8'))
        const model = typeof raw?.current_model_id === 'string' && raw.current_model_id
          ? raw.current_model_id
          : null
        if (model) out.set(sid, model)
      } catch { /* skip */ }
    }
  }
  return out
}

export function grokModelMapFingerprint(
  modelByLog: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string {
  const hash = createHash('sha256')
  let remaining = MAX_MODEL_FINGERPRINT_ENTRIES
  const field = (value: string) => {
    hash.update(String(Buffer.byteLength(value))).update(':').update(value).update('\0')
  }
  for (const [logPath, models] of [...modelByLog].sort(([left], [right]) => left.localeCompare(right))) {
    field(logPath)
    const entries = [...models].sort(([left], [right]) => left.localeCompare(right))
    for (const [sessionId, model] of entries.slice(0, remaining)) {
      field(sessionId)
      field(model)
    }
    remaining -= Math.min(entries.length, remaining)
    if (remaining === 0) break
  }
  return hash.digest('hex').slice(0, 24)
}

function costOf(model: string, input: number, cacheRead: number, output: number): { cost: number; cacheSavings: number } {
  const p = priceFor(model)
  const cost = input * p.in + cacheRead * p.cr + output * p.out
  const cacheSavings = cacheRead * Math.max(0, p.in - p.cr)
  return { cost, cacheSavings }
}

async function parseUnifiedLog(path: string, models: Map<string, string>): Promise<Entry[]> {
  const entries: Entry[] = []
  const input = createReadStream(path)
  input.on('error', () => {})
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (!line.includes('shell.turn.inference_done')) continue
      try {
        const obj = JSON.parse(line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line)
        if (obj?.msg !== 'shell.turn.inference_done' || !obj.ctx) continue
        const ts = Date.parse(String(obj.ts ?? ''))
        if (!Number.isFinite(ts)) continue
        const sid = typeof obj.sid === 'string' ? obj.sid : 'unknown'
        const ctx = obj.ctx
        const prompt = safeNum(ctx.prompt_tokens)
        const cached = safeNum(ctx.cached_prompt_tokens)
        const completion = safeNum(ctx.completion_tokens)
        // cached ⊂ prompt; reasoning ⊂ completion — do not add them.
        const inputTokens = Math.max(0, prompt - cached)
        const cacheRead = cached
        const output = completion
        if (inputTokens + cacheRead + output <= 0) continue
        const model = models.get(sid) ?? 'grok-4.5'
        const { cost, cacheSavings } = costOf(model, inputTokens, cacheRead, output)
        const loop = safeNum(ctx.loop_index)
        entries.push({
          ts,
          id: `${sid}#${obj.ts}#${loop}`,
          model,
          input: inputTokens,
          output,
          cacheCreate: 0,
          cacheRead,
          cost,
          cacheSavings,
        })
      } catch { /* bad line */ }
    }
  } finally {
    rl.close()
    input.destroy()
  }
  return entries
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const files: { path: string; mtimeMs: number; size: number }[] = []
  const modelByHome = new Map<string, Map<string, string>>()
  for (const home of grokHomes(homeDir)) {
    const logPath = join(home, 'logs', 'unified.jsonl')
    try { await access(logPath) } catch { continue }
    const st = await fsStat(logPath).catch(() => null)
    if (!st) continue
    files.push({ path: logPath, mtimeMs: st.mtimeMs, size: st.size })
    modelByHome.set(logPath, await loadSessionModels(home))
  }
  if (files.length === 0) return []
  return loadCachedEntries(
    files,
    async (path) => parseUnifiedLog(path, modelByHome.get(path) ?? new Map()),
    since,
    { fingerprint: { parser: `grok-unified-v2.${grokModelMapFingerprint(modelByHome)}` } },
  )
}

export async function grokDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  return summarize(await loadEntries(dashboardSince(tz), homeDir), tz)
}

export async function grokTable(tz: string, homeDir?: string): Promise<TableData> {
  return tabulate(await loadEntries(tableSince(tz), homeDir), tz)
}
