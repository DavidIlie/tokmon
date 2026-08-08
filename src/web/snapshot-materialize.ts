import type { WebSnapshotSchema } from '../rpc/contract'
import type { WebAccount, WebSnapshot } from './contract'

export type WireSnapshot = typeof WebSnapshotSchema.Type
export type WireAccount = WireSnapshot['accounts'][number]
type WireTable = NonNullable<WireAccount['table']>

/** Copy Schema's readonly decode model into the mutable application model. */
export function materializeHeadroom(headroom: WireAccount['headroom']): WebAccount['headroom'] {
  return headroom
    ? {
        ...headroom,
        activeAccountIds: [...headroom.activeAccountIds],
        factors: headroom.factors.map(factor => ({ ...factor })),
      }
    : undefined
}

export function materializeDashboard(dashboard: WireAccount['dashboard']): WebAccount['dashboard'] {
  return dashboard
    ? {
        ...dashboard,
        today: { ...dashboard.today },
        week: { ...dashboard.week },
        month: { ...dashboard.month },
        series: [...dashboard.series],
      }
    : null
}

function materializeRows(rows: WireTable['daily']) {
  return rows.map(row => ({
    ...row,
    models: [...row.models],
    breakdown: row.breakdown.map(detail => ({ ...detail })),
  }))
}

export function materializeTable(table: WireAccount['table']): WebAccount['table'] {
  return table
    ? {
        daily: materializeRows(table.daily),
        weekly: materializeRows(table.weekly),
        monthly: materializeRows(table.monthly),
      }
    : null
}

export function materializeBilling(billing: WireAccount['billing']): WebAccount['billing'] {
  if (!billing) return null
  // Destructure the optional sections out so key absence is preserved exactly:
  // adding explicit `undefined` entries changes deep-equality against the
  // encoder's source snapshot and bloats every JSON frame.
  const { activity, modelSpend, ...rest } = billing
  return {
    ...rest,
    metrics: billing.metrics.map(metric => ({
      ...metric,
      format: { ...metric.format },
    })),
    ...(activity !== undefined
      ? { activity: activity ? { ...activity, series: [...activity.series] } : activity }
      : {}),
    ...(modelSpend !== undefined
      ? { modelSpend: modelSpend == null ? modelSpend : modelSpend.map(spend => ({ ...spend })) }
      : {}),
  }
}

/** Everything on an account except the heavy dashboard/table/billing sections. */
export function materializeAccountShell(
  account: Omit<WireAccount, 'dashboard' | 'table' | 'billing'>,
): Omit<WebAccount, 'dashboard' | 'table' | 'billing'> {
  // Destructured so absent optional keys stay absent (see materializeBilling).
  const { identity, quotas, headroom, ...rest } = account
  return {
    ...rest,
    ...(identity !== undefined ? { identity: { ...identity } } : {}),
    ...(quotas !== undefined ? { quotas: quotas.map(quota => ({ ...quota })) } : {}),
    ...(headroom !== undefined ? { headroom: materializeHeadroom(headroom) } : {}),
    summaryUpdatedAt: account.summaryUpdatedAt ?? null,
    billingUpdatedAt: account.billingUpdatedAt ?? null,
    tableUpdatedAt: account.tableUpdatedAt ?? null,
  }
}

export function materializeAccount(account: WireAccount): WebAccount {
  return {
    ...materializeAccountShell(account),
    dashboard: materializeDashboard(account.dashboard),
    table: materializeTable(account.table),
    billing: materializeBilling(account.billing),
  }
}

export function materializeWebSnapshot(snapshot: WireSnapshot): WebSnapshot {
  return {
    ...snapshot,
    providers: snapshot.providers.map(provider => {
      const { headroom, ...rest } = provider
      return {
        ...rest,
        ...(headroom !== undefined ? { headroom: materializeHeadroom(headroom) } : {}),
      }
    }),
    accounts: snapshot.accounts.map(materializeAccount),
    peak: snapshot.peak ? { ...snapshot.peak } : null,
  } as WebSnapshot
}
