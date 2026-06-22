// Pure projection of a daemon WebSnapshot into the exact shapes the existing
// Ink views already consume (AccountStats / TableData / CursorModelSpend[]).
// This seam is what lets the TUI render unchanged in S6: the engine ships ALL
// resolved accounts (a superset, disabled included), and the client scopes the
// view down here using its own resolved Account[] (which carry the named/config
// colors — per the blueprint, colors stay client-side, NOT from WebAccount.color).

import { coalesceTables } from '../providers/usage-core'
import type { Account } from '../providers/types'
import type { AccountStats } from '../stats'
import type { CursorModelSpend } from '../providers/cursor/composer'
import type { TableData, WebAccount, WebSnapshot } from '../web/contract'

// Index a snapshot's accounts by id once, so the helpers below are O(1) lookups.
function indexById(snapshot: WebSnapshot | null): Map<string, WebAccount> {
  const m = new Map<string, WebAccount>()
  if (snapshot) for (const a of snapshot.accounts) m.set(a.id, a)
  return m
}

// Build the Map<id, AccountStats> the dashboard/loading views render. The
// `account` (incl. its config-resolved color) comes from the CLIENT's resolved
// accounts; dashboard/billing come from the daemon snapshot. Only accounts the
// client currently shows are included (view scoping stays client-side).
export function toStatsMap(
  snapshot: WebSnapshot | null,
  accounts: Account[],
): Map<string, AccountStats> {
  const byId = indexById(snapshot)
  const out = new Map<string, AccountStats>()
  for (const account of accounts) {
    const wa = byId.get(account.id)
    out.set(account.id, {
      account,
      dashboard: wa?.dashboard ?? null,
      billing: wa?.billing ?? null,
    })
  }
  return out
}

// Cursor model-spend rows, derived from billing.modelSpend (decision #4 — NO
// dedicated snapshot field). Returns null when the account/billing isn't loaded
// yet so the view can show its spinner; [] when loaded-but-empty.
export function toCursorRows(
  snapshot: WebSnapshot | null,
  accountId: string | null | undefined,
): CursorModelSpend[] | null {
  if (!snapshot || !accountId) return null
  const wa = snapshot.accounts.find(a => a.id === accountId)
  if (!wa) return null
  if (wa.billingState === 'pending') return null
  const spend = wa.billing?.modelSpend
  if (!spend) return []
  return spend.map(m => ({ name: m.name, usd: m.usd, requests: m.requests }))
}

// Merge the per-account tables for a scope into one TableData, exactly like the
// old in-process fetchScopeTable did — but reading the daemon's already-fetched
// tables instead of fetching. accountIds is the client's current table scope.
export function pickTable(
  snapshot: WebSnapshot | null,
  accountIds: string[],
): TableData | null {
  if (!snapshot) return null
  const byId = indexById(snapshot)
  const tables: TableData[] = []
  for (const id of accountIds) {
    const t = byId.get(id)?.table
    if (t) tables.push(t)
  }
  return coalesceTables(tables)
}
