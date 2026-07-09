import { glyphs } from './glyphs'
import { PROVIDERS, type Account } from './providers'
import { coalesceTables } from './providers/usage-core'
import type { Config } from './config'
import type { AccountStats } from './stats'
import type { TableData, TableRow } from './types'

export const TABS = ['Dashboard', 'Table'] as const
export const VIEWS = ['Daily', 'Weekly', 'Monthly'] as const
export const SORTS = [
  { label: 'date', dir: 'up' as const },
  { label: 'date', dir: 'down' as const },
  { label: 'cost', dir: 'up' as const },
  { label: 'cost', dir: 'down' as const },
] as const

export type Slot = { id: string | null; name: string; color: string }

export const acctKey = (a: Account): string => `${a.id}:${a.homeDir ?? ''}`

export const clampCaret = (caret: number, len: number): number => Math.max(0, Math.min(caret, len))

export function spliceInsert(value: string, caret: number, text: string): { value: string; caret: number } {
  const c = clampCaret(caret, value.length)
  return { value: value.slice(0, c) + text + value.slice(c), caret: c + text.length }
}

export function spliceBackspace(value: string, caret: number): { value: string; caret: number } {
  const c = clampCaret(caret, value.length)
  if (c === 0) return { value, caret: 0 }
  return { value: value.slice(0, c - 1) + value.slice(c), caret: c - 1 }
}

export function applyStartup(c: Config, cliInterval?: number): Config {
  if (cliInterval) c = { ...c, interval: cliInterval / 1000 }
  if (c.defaultFocus === 'all') c = { ...c, activeAccountId: null }
  return c
}

export function upsert(prev: Map<string, AccountStats>, account: Account, patch: Partial<AccountStats>): Map<string, AccountStats> {
  const next = new Map(prev)
  const cur = next.get(account.id) ?? { account, dashboard: null, billing: null }
  next.set(account.id, { ...cur, account, ...patch })
  return next
}

export async function fetchScopeTable(scope: Account[], tz: string): Promise<TableData> {
  const tables = await Promise.all(scope.map(async (acc) => {
    const provider = PROVIDERS[acc.providerId]
    if (!provider.fetchTable) return null
    try { return await provider.fetchTable(acc, tz) } catch { return null }
  }))
  const valid = tables.filter((t): t is TableData => t !== null)
  return coalesceTables(valid)
}

export function sortLabel(entry: { label: string; dir: 'up' | 'down' | null }): string {
  if (entry.dir === 'up') return `${entry.label} ${glyphs().arrowU}`
  if (entry.dir === 'down') return `${entry.label} ${glyphs().arrowD}`
  return entry.label
}

export function sortRows(rows: TableRow[], sortIdx: number): TableRow[] {
  const sorted = [...rows]
  switch (sortIdx % SORTS.length) {
    case 0: return sorted.sort((a, b) => a.label.localeCompare(b.label))
    case 1: return sorted.sort((a, b) => b.label.localeCompare(a.label))
    case 2: return sorted.sort((a, b) => a.cost - b.cost)
    case 3: return sorted.sort((a, b) => b.cost - a.cost)
    default: return sorted
  }
}

export function tableModelOptions(rows: TableRow[]): string[] {
  const models = new Set<string>()
  for (const row of rows) for (const model of row.breakdown) models.add(model.name)
  return [...models].sort()
}

export function cycleTableModel(current: string | null, models: readonly string[], dir: 1 | -1): string | null {
  if (models.length === 0) return null
  const idx = current ? models.indexOf(current) : -1
  if (dir === 1) {
    if (idx < 0) return models[0]
    return idx === models.length - 1 ? null : models[idx + 1]
  }
  if (idx < 0) return models[models.length - 1]
  return idx === 0 ? null : models[idx - 1]
}

export function filterRowsByModel(rows: TableRow[], model: string | null): TableRow[] {
  if (!model) return rows
  return rows.flatMap(row => {
    const detail = row.breakdown.find(m => m.name === model)
    if (!detail) return []
    const input = detail.input
    const output = detail.output
    const cacheCreate = detail.cacheCreate
    const cacheRead = detail.cacheRead
    return [{
      label: row.label,
      models: [model],
      input,
      output,
      cacheCreate,
      cacheRead,
      cacheSavings: detail.cacheSavings,
      total: input + output + cacheCreate + cacheRead,
      cost: detail.cost,
      count: detail.count,
      breakdown: [{ ...detail }],
    }]
  })
}

export function filterTokenRows(rows: TableRow[], q: string): TableRow[] {
  if (!q) return rows
  const s = q.toLowerCase()
  return rows.filter(r => r.label.toLowerCase().includes(s) || r.models.some(m => m.toLowerCase().includes(s)))
}
