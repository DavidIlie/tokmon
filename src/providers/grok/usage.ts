import { access, readdir, readFile, stat as fsStat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { DashboardData, TableData } from '../../types'
import { type Entry, summarize, tabulate, loadCachedEntries, safeNum, dashboardSince, tableSince } from '../usage-core'
import { readJsonLines } from '../_shared/jsonl'
import { modelKeyMatches } from '../_shared/metric'
import { makePriceResolver } from '../_shared/pricing'
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
const resolvePrice = makePriceResolver(PRICING, { fallback: FALLBACK_PRICE, matches: modelKeyMatches })
const MAX_SESSION_GROUPS = 128
const MAX_SESSIONS_PER_GROUP = 512
const MAX_MODEL_FINGERPRINT_ENTRIES = MAX_SESSION_GROUPS * MAX_SESSIONS_PER_GROUP * 2

function priceFor(model: string) {
  return resolvePrice(model)
}

export async function detectGrok(homeDir?: string): Promise<boolean> {
  for (const home of grokHomes(homeDir)) {
    for (const p of [join(home, 'logs', 'unified.jsonl'), join(home, 'sessions'), join(home, 'auth.json')]) {
      try { await access(p); return true } catch { /* next */ }
    }
  }
  return false
}

/** Most-recently-modified first; ties broken by name for determinism. */
async function byMtimeDesc(dir: string, names: string[]): Promise<string[]> {
  const stated = await Promise.all(names.map(async (name) => {
    const st = await fsStat(join(dir, name)).catch(() => null)
    return { name, mtimeMs: st ? st.mtimeMs : -Infinity }
  }))
  stated.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
  return stated.map((s) => s.name)
}

async function loadSessionModels(home: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const sessionsRoot = join(home, 'sessions')
  let groups: string[]
  try { groups = await readdir(sessionsRoot) } catch { return out }
  const groupNames = groups.filter((g) => g !== 'session_search.sqlite' && !g.startsWith('.'))
  const orderedGroups = (await byMtimeDesc(sessionsRoot, groupNames)).slice(0, MAX_SESSION_GROUPS)
  for (const group of orderedGroups) {
    const groupDir = join(sessionsRoot, group)
    let sessions: string[]
    try { sessions = await readdir(groupDir) } catch { continue }
    const sessionNames = sessions.filter((s) => !s.startsWith('.'))
    const orderedSessions = (await byMtimeDesc(groupDir, sessionNames)).slice(0, MAX_SESSIONS_PER_GROUP)
    for (const sid of orderedSessions) {
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

// The default when a turn's model can't be determined from log or summary.
const DEFAULT_MODEL = 'grok-4.5'

/** A model-change event's new active model, if this line is one. */
function modelChangeFrom(obj: { msg?: unknown; ctx?: unknown }): string | null {
  if (obj?.msg !== 'model changed' && obj?.msg !== 'backend_search: model switch') return null
  const ctx = obj.ctx
  if (!ctx || typeof ctx !== 'object') return null
  const c = ctx as { model?: unknown; new_model?: unknown }
  const model = typeof c.model === 'string' ? c.model : typeof c.new_model === 'string' ? c.new_model : null
  return model && model.trim() ? model : null
}

export async function parseUnifiedLog(path: string, models: Map<string, string>): Promise<Entry[]> {
  const entries: Entry[] = []
  // Per-session running model, updated as "model changed" events stream past in log order.
  // inference_done carries no model field, so the active model is derived from these events;
  // before the first such event we fall back to summary.json, then the default tier.
  const activeModel = new Map<string, string>()
  const relevantLine = (line: string) =>
    line.includes('shell.turn.inference_done')
    || line.includes('model changed')
    || line.includes('model switch')
  for await (const obj of readJsonLines(path, relevantLine, { ignoreReadErrors: false })) {
    try {
      const sid = typeof obj.sid === 'string' ? obj.sid : 'unknown'
      const switched = modelChangeFrom(obj)
      if (switched) { activeModel.set(sid, switched); continue }
      if (obj?.msg !== 'shell.turn.inference_done' || !obj.ctx) continue
      const ts = Date.parse(String(obj.ts ?? ''))
      if (!Number.isFinite(ts)) continue
      const ctx = obj.ctx
      const prompt = safeNum(ctx.prompt_tokens)
      const cached = safeNum(ctx.cached_prompt_tokens)
      const completion = safeNum(ctx.completion_tokens)
      // cached ⊂ prompt; reasoning ⊂ completion — do not add them.
      const inputTokens = Math.max(0, prompt - cached)
      const cacheRead = cached
      const output = completion
      if (inputTokens + cacheRead + output <= 0) continue
      const model = activeModel.get(sid) ?? models.get(sid) ?? DEFAULT_MODEL
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
    { fingerprint: { parser: `grok-unified-v3.${grokModelMapFingerprint(modelByHome)}` } },
  )
}

export async function grokDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  return summarize(await loadEntries(dashboardSince(tz), homeDir), tz)
}

export async function grokTable(tz: string, homeDir?: string): Promise<TableData> {
  return tabulate(await loadEntries(tableSince(tz), homeDir), tz)
}
