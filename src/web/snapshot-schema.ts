import { Option, Schema } from 'effect'
import { WebSnapshotSchema } from '../rpc/contract'
import type { WebSnapshot } from './contract'

type WireSnapshot = typeof WebSnapshotSchema.Type
type WireTable = NonNullable<WireSnapshot['accounts'][number]['table']>

/** Copy Schema's readonly decode model into the mutable application model. */
export function materializeWebSnapshot(snapshot: WireSnapshot): WebSnapshot {
  const copyHeadroom = (headroom: WireSnapshot['providers'][number]['headroom']) => headroom
    ? {
        ...headroom,
        activeAccountIds: [...headroom.activeAccountIds],
        factors: headroom.factors.map(factor => ({ ...factor })),
      }
    : undefined
  const copyRows = (rows: WireTable['daily']) => rows.map(row => ({
    ...row,
    models: [...row.models],
    breakdown: row.breakdown.map(detail => ({ ...detail })),
  }))

  return {
    ...snapshot,
    providers: snapshot.providers.map(provider => ({
      ...provider,
      headroom: copyHeadroom(provider.headroom),
    })),
    accounts: snapshot.accounts.map(account => ({
      ...account,
      identity: account.identity ? { ...account.identity } : undefined,
      quotas: account.quotas?.map(quota => ({ ...quota })),
      headroom: copyHeadroom(account.headroom),
      dashboard: account.dashboard
        ? {
            ...account.dashboard,
            today: { ...account.dashboard.today },
            week: { ...account.dashboard.week },
            month: { ...account.dashboard.month },
            series: [...account.dashboard.series],
          }
        : null,
      table: account.table
        ? {
            daily: copyRows(account.table.daily),
            weekly: copyRows(account.table.weekly),
            monthly: copyRows(account.table.monthly),
          }
        : null,
      billing: account.billing
        ? {
            ...account.billing,
            metrics: account.billing.metrics.map(metric => ({
              ...metric,
              format: { ...metric.format },
            })),
            activity: account.billing.activity
              ? { ...account.billing.activity, series: [...account.billing.activity.series] }
              : account.billing.activity,
            modelSpend: account.billing.modelSpend == null
              ? account.billing.modelSpend
              : account.billing.modelSpend.map(spend => ({ ...spend })),
          }
        : null,
      summaryUpdatedAt: account.summaryUpdatedAt ?? null,
      billingUpdatedAt: account.billingUpdatedAt ?? null,
      tableUpdatedAt: account.tableUpdatedAt ?? null,
    })),
    peak: snapshot.peak ? { ...snapshot.peak } : null,
  }
}

const decodeWireSnapshot = Schema.decodeUnknownOption(WebSnapshotSchema)

export function decodeWebSnapshot(value: unknown): WebSnapshot | null {
  return Option.map(decodeWireSnapshot(value), materializeWebSnapshot).pipe(Option.getOrNull)
}
