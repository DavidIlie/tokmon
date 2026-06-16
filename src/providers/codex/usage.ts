import { readdir, stat as fsStat, access } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { DashboardData, TableData } from '../../types'
import { startOfMonth, startOfWeek, monthsAgoStart } from '../../tz'
import { envDir } from '../../config'
import { type Entry, summarize, tabulate, SPARK_DAYS, loadCachedEntries, safeNum } from '../usage-core'

// OpenAI API pricing (USD per token) for the GPT-5 / Codex family. Codex on a
// ChatGPT plan is flat-rate, so this is an *estimated API-equivalent* cost.
//
// Cached input IS billed, but at the per-model cache-read rate (`cr`) — the
// real OpenAI discount (~1/10 of input for gpt-5, ~4x for o4-mini), NOT the
// full input rate. Charging cached reads at full rate is the trap that makes
// other trackers (devrage) report ~10x inflated cost, since Codex re-sends the
// mostly-cached context every turn (~94% of input is cache reads on real data).
// Pricing cached at the true discounted rate keeps the estimate honest without
// the inflation; the UI also surfaces the cached share + cache savings.
const PRICING: Record<string, { in: number; cr: number; out: number }> = {
  'gpt-5-codex': { in: 1.25e-6, cr: 0.125e-6, out: 10e-6 },
  'gpt-5-mini': { in: 0.25e-6, cr: 0.025e-6, out: 2e-6 },
  'gpt-5-nano': { in: 0.05e-6, cr: 0.005e-6, out: 0.4e-6 },
  'gpt-5': { in: 1.25e-6, cr: 0.125e-6, out: 10e-6 },
  'o4-mini': { in: 1.1e-6, cr: 0.275e-6, out: 4.4e-6 },
}
const FALLBACK = PRICING['gpt-5-codex']
const PRICE_KEYS = Object.keys(PRICING).sort((a, b) => b.length - a.length)

export function codexHomes(homeDir?: string): string[] {
  if (homeDir) return [join(homeDir, '.codex')]
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
  }
  return false
}

function priceFor(model: string) {
  const m = model.toLowerCase()
  for (const key of PRICE_KEYS) {
    if (m.startsWith(key) || m.includes(key)) return PRICING[key]
  }
  return FALLBACK
}

/** The model is announced in `turn_context` events; token_count events don't carry it. */
function extractModel(obj: any): string | null {
  const p = obj?.payload ?? obj
  return p?.model
    || p?.collaboration_mode?.settings?.model
    || p?.model_slug
    || p?.config?.model
    || p?.info?.model
    || null
}

interface CodexDelta {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

/** Per-field clamped difference, for deriving a delta from cumulative totals. */
function subtractClamped(cur: CodexDelta, prev: CodexDelta | null): CodexDelta {
  const sub = (a?: number, b?: number) => Math.max(0, (a ?? 0) - (b ?? 0))
  return {
    input_tokens: sub(cur.input_tokens, prev?.input_tokens),
    cached_input_tokens: sub(cur.cached_input_tokens, prev?.cached_input_tokens),
    output_tokens: sub(cur.output_tokens, prev?.output_tokens),
    reasoning_output_tokens: sub(cur.reasoning_output_tokens, prev?.reasoning_output_tokens),
  }
}

/** Signature of a token_count event's raw usage (per-turn delta + cumulative).
 *  Codex sometimes re-emits the identical event with a later timestamp; those
 *  carry no new usage (the cumulative total is unchanged), so a consecutive
 *  signature match flags a re-emission to skip. */
function eventSig(last: CodexDelta | undefined, total: CodexDelta | undefined): string {
  const f = (x: CodexDelta | undefined) =>
    x ? `${x.input_tokens ?? 0},${x.cached_input_tokens ?? 0},${x.output_tokens ?? 0},${x.reasoning_output_tokens ?? 0}` : '-'
  return `${f(last)}|${f(total)}`
}

async function parseFile(path: string): Promise<Entry[]> {
  const entries: Entry[] = []
  let model = 'gpt-5-codex'
  let prevTotal: CodexDelta | null = null
  let prevSig: string | null = null
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const rawLine of rl) {
    // Cheap pre-filter: only the two event kinds we care about.
    if (!rawLine.includes('token_count') && !rawLine.includes('turn_context')) continue
    // Whole-line try: one malformed line (or unexpected shape) drops that line,
    // never the rest of the file. Strip a leading BOM before parsing.
    try {
      const line = rawLine.charCodeAt(0) === 0xFEFF ? rawLine.slice(1) : rawLine
      const obj: any = JSON.parse(line)

      const payloadType = obj?.payload?.type ?? obj?.type
      if (payloadType === 'turn_context') {
        const m = extractModel(obj)
        if (typeof m === 'string' && m.trim()) model = m   // ignore non-string/empty models
        continue
      }
      if (payloadType !== 'token_count') continue

      // Prefer the per-turn delta (last_token_usage). When it's missing, derive
      // the delta from the cumulative total minus the previous cumulative — never
      // sum total_token_usage directly (it's a running total → huge overcount).
      const info = obj?.payload?.info
      const total: CodexDelta | undefined = info?.total_token_usage
      const last: CodexDelta | undefined = info?.last_token_usage
      // Skip a verbatim re-emission of the previous token_count (same per-turn
      // delta AND same cumulative total = the ledger didn't advance, so no new
      // usage). The value-tuple dedup in usage-core keys on the timestamp, so it
      // misses these later-timestamped copies; without this skip Codex
      // over-counts ~0.18% (matches devrage's consecutive-signature de-dup).
      const sig = eventSig(last, total)
      if (sig === prevSig) continue
      prevSig = sig

      let d: CodexDelta | undefined = last
      if (!d && total) {
        // After compaction/reset the cumulative total drops — treat the new total
        // as a fresh baseline delta instead of clamping it to zero (lost turn).
        const reset = !!prevTotal && (total.input_tokens ?? 0) < (prevTotal.input_tokens ?? 0)
        d = reset ? total : subtractClamped(total, prevTotal)
      }
      if (total) prevTotal = total
      if (!d) continue

      const ts = new Date(obj.timestamp ?? obj?.payload?.timestamp ?? 0).getTime()
      if (!Number.isFinite(ts)) continue

      const inputTotal = safeNum(d.input_tokens)
      const cached = Math.min(safeNum(d.cached_input_tokens), inputTotal) // cached ⊆ input
      const input = inputTotal - cached
      const output = safeNum(d.output_tokens)          // includes reasoning tokens
      if (input + output + cached === 0) continue

      const p = priceFor(model)
      entries.push({
        ts,
        model,
        cost: input * p.in + cached * p.cr + output * p.out,
        input,
        output,
        cacheCreate: 0,
        cacheRead: cached,
        cacheSavings: cached * (p.in - p.cr),
      })
    } catch { /* skip a single malformed/unexpected line */ }
  }
  return entries
}

async function loadEntries(since: number, homeDir?: string): Promise<Entry[]> {
  const files: { path: string; mtimeMs: number; size: number }[] = []
  const seen = new Set<string>()      // by path
  const seenIno = new Set<string>()   // by inode — collapses symlink-loop duplicates

  for (const home of codexHomes(homeDir)) {
    const dir = join(home, 'sessions')
    let listing: string[]
    try {
      listing = await readdir(dir, { recursive: true })
    } catch {
      continue
    }
    for (const f of listing) {
      if (!f.endsWith('.jsonl') || !f.includes('rollout-')) continue
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

export async function codexDashboard(tz: string, homeDir?: string): Promise<DashboardData> {
  const now = Date.now()
  const since = Math.min(startOfMonth(now, tz), startOfWeek(now, tz), now - SPARK_DAYS * 86_400_000)
  const entries = await loadEntries(since, homeDir)
  return summarize(entries, tz)
}

export async function codexTable(tz: string, homeDir?: string): Promise<TableData> {
  const entries = await loadEntries(monthsAgoStart(Date.now(), 6, tz), homeDir)
  return tabulate(entries, tz)
}
