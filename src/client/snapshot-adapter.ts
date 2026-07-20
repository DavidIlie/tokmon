import { coalesceTables } from '../providers/usage-core'
import type { Account } from '../providers/types'
import type { AccountStats } from '../stats'
import type { TableData, WebAccount, WebSnapshot } from '../web/contract'

function indexById(snapshot: WebSnapshot | null): Map<string, WebAccount> {
  const m = new Map<string, WebAccount>()
  if (snapshot) for (const a of snapshot.accounts) m.set(a.id, a)
  return m
}

export function toStatsMap(
  snapshot: WebSnapshot | null,
  accounts: Account[],
): Map<string, AccountStats> {
  const byId = indexById(snapshot)
  const providerHeadroom = new Map(snapshot?.providers.map(provider => [provider.id, provider.headroom] as const) ?? [])
  const out = new Map<string, AccountStats>()
  for (const account of accounts) {
    const wa = byId.get(account.id)
    out.set(account.id, {
      account,
      dashboard: wa?.dashboard ?? null,
      billing: wa?.billing ?? null,
      billingUpdatedAt: wa?.billingUpdatedAt ?? null,
      identity: wa?.identity,
      quotas: wa?.quotas,
      headroom: wa?.headroom,
      providerHeadroom: providerHeadroom.get(account.providerId),
    })
  }
  return out
}

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
