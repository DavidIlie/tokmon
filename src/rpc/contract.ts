import { Schema } from 'effect'
import * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import { PROVIDER_IDS } from '../providers/types'
import type { Config } from '../config-schema'

export const TOKMON_WS_PATH = '/ws'

/** Bump only for an incompatible wire change. Capabilities gate additive features. */
export const TOKMON_PROTOCOL_VERSION = 3
export const TOKMON_CAPABILITIES = ['config-cas', 'config-revision', 'allowed-hosts'] as const
export type TokmonCapability = typeof TOKMON_CAPABILITIES[number]

export const TOKMON_WS_METHODS = {
  getConfig: 'tokmon.getConfig',
  setConfig: 'tokmon.setConfig',
  refresh: 'tokmon.refresh',
  browseFs: 'tokmon.browseFs',
  snapshot: 'tokmon.snapshot',
  config: 'tokmon.config',
} as const

export const RefreshScopeSchema = Schema.Literals([
  'all',
  'summary',
  'table',
  'billing',
  'peak',
] as const)

export type RefreshScope = typeof RefreshScopeSchema.Type

const ProviderIdSchema = Schema.Literals(PROVIDER_IDS)
const NonNegativeIntegerSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveFiniteSchema = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1))

const AccountSchema = Schema.Struct({
  id: Schema.String,
  providerId: ProviderIdSchema,
  name: Schema.String,
  homeDir: Schema.String,
  color: Schema.optionalKey(Schema.String),
})

/** The persisted config shape. This is deliberately strict at every RPC boundary. */
export const ConfigSchema = Schema.Struct({
  revision: NonNegativeIntegerSchema,
  interval: PositiveFiniteSchema,
  billingInterval: PositiveFiniteSchema,
  clearScreen: Schema.Boolean,
  privacyMode: Schema.Boolean,
  privacyToggleKey: Schema.String,
  timezone: Schema.NullOr(Schema.String),
  accounts: Schema.Array(AccountSchema),
  activeAccountId: Schema.NullOr(Schema.String),
  disabledProviders: Schema.Array(ProviderIdSchema),
  onboarded: Schema.Boolean,
  dashboardLayout: Schema.Literals(['grid', 'single'] as const),
  defaultFocus: Schema.Literals(['all', 'last'] as const),
  ascii: Schema.Literals(['auto', 'on', 'off'] as const),
  allowNetworkAccess: Schema.Boolean,
  allowedHosts: Schema.Array(Schema.String),
  resetDisplay: Schema.Literals(['relative', 'absolute'] as const),
  knownProviders: Schema.Array(ProviderIdSchema),
})

export const ProtocolInfoSchema = Schema.Struct({
  version: Schema.Literal(TOKMON_PROTOCOL_VERSION),
  // Capabilities are additive within a protocol version. Older clients must
  // preserve forward compatibility when a newer daemon advertises one they do
  // not understand yet.
  capabilities: Schema.Array(Schema.String),
})

export interface ProtocolInfo {
  version: typeof TOKMON_PROTOCOL_VERSION
  capabilities: readonly string[]
}

export interface ConfigState {
  protocol: ProtocolInfo
  config: Config
}

export const ConfigStateSchema = Schema.Struct({
  protocol: ProtocolInfoSchema,
  config: ConfigSchema,
})

export interface ConfigUpdateRequest {
  /** The server revision the editor was based on. */
  expectedRevision: number
  config: Config
}

export const ConfigUpdateRequestSchema = Schema.Struct({
  expectedRevision: NonNegativeIntegerSchema,
  config: ConfigSchema,
})

export interface ConfigUpdateConflict {
  readonly kind: 'conflict'
  readonly state: ConfigState
}

export const ConfigUpdateConflictSchema = Schema.Struct({
  kind: Schema.Literal('conflict'),
  state: ConfigStateSchema,
})

export interface ConfigPersistenceFailure {
  readonly kind: 'persistence'
  readonly message: string
}

export const ConfigPersistenceFailureSchema = Schema.Struct({
  kind: Schema.Literal('persistence'),
  message: Schema.String,
})

export const FsEntrySchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  dir: Schema.Boolean,
})

export const FsListingSchema = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  entries: Schema.Array(FsEntrySchema),
})

export type FsListing = typeof FsListingSchema.Type

const UsageSummarySchema = Schema.Struct({
  cost: Schema.Finite,
  tokens: Schema.Finite,
  input: Schema.Finite,
  cacheRead: Schema.Finite,
  cacheSavings: Schema.Finite,
})

const ModelDetailSchema = Schema.Struct({
  name: Schema.String,
  input: Schema.Finite,
  output: Schema.Finite,
  cacheCreate: Schema.Finite,
  cacheRead: Schema.Finite,
  cacheSavings: Schema.Finite,
  cost: Schema.Finite,
  count: Schema.Finite,
})

const TableRowSchema = Schema.Struct({
  label: Schema.String,
  models: Schema.Array(Schema.String),
  input: Schema.Finite,
  output: Schema.Finite,
  cacheCreate: Schema.Finite,
  cacheRead: Schema.Finite,
  cacheSavings: Schema.Finite,
  total: Schema.Finite,
  cost: Schema.Finite,
  count: Schema.Finite,
  breakdown: Schema.Array(ModelDetailSchema),
})

const DashboardDataSchema = Schema.Struct({
  today: UsageSummarySchema,
  week: UsageSummarySchema,
  month: UsageSummarySchema,
  burnRate: Schema.Finite,
  series: Schema.Array(Schema.Finite),
})

const TableDataSchema = Schema.Struct({
  daily: Schema.Array(TableRowSchema),
  weekly: Schema.Array(TableRowSchema),
  monthly: Schema.Array(TableRowSchema),
})

const MetricFormatSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('percent') }),
  Schema.Struct({ kind: Schema.Literal('dollars'), currency: Schema.optionalKey(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('count'), suffix: Schema.optionalKey(Schema.String) }),
])

const MetricSchema = Schema.Struct({
  label: Schema.String,
  used: Schema.Finite,
  limit: Schema.NullOr(Schema.Finite),
  format: MetricFormatSchema,
  resetsAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  primary: Schema.optionalKey(Schema.Boolean),
})

const BillingResultSchema = Schema.Struct({
  plan: Schema.NullOr(Schema.String),
  metrics: Schema.Array(MetricSchema),
  error: Schema.NullOr(Schema.String),
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
  displayName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  activity: Schema.optionalKey(Schema.NullOr(Schema.Struct({
    series: Schema.Array(Schema.Finite),
    summary: Schema.String,
  }))),
  modelSpend: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({
    name: Schema.String,
    usd: Schema.Finite,
    requests: Schema.Finite,
  })))),
  asOfMs: Schema.optionalKey(Schema.Finite),
})

const WebAccountSchema = Schema.Struct({
  id: Schema.String,
  providerId: ProviderIdSchema,
  name: Schema.String,
  color: Schema.String,
  homeDir: Schema.NullOr(Schema.String),
  hasUsage: Schema.Boolean,
  hasBilling: Schema.Boolean,
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
  displayName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  plan: Schema.optionalKey(Schema.NullOr(Schema.String)),
  dashboard: Schema.NullOr(DashboardDataSchema),
  table: Schema.NullOr(TableDataSchema),
  billing: Schema.NullOr(BillingResultSchema),
  summaryState: Schema.Literals(['pending', 'ready', 'error'] as const),
  billingState: Schema.Literals(['pending', 'ready', 'error'] as const),
  tableState: Schema.Literals(['pending', 'ready', 'error'] as const),
  summaryUpdatedAt: Schema.optionalKey(Schema.NullOr(NonNegativeIntegerSchema)),
  billingUpdatedAt: Schema.optionalKey(Schema.NullOr(NonNegativeIntegerSchema)),
  tableUpdatedAt: Schema.optionalKey(Schema.NullOr(NonNegativeIntegerSchema)),
})

/** Runtime validation for streamed dashboard state; unknown JSON is never trusted. */
export const WebSnapshotSchema = Schema.Struct({
  version: Schema.String,
  generatedAt: NonNegativeIntegerSchema,
  tz: Schema.String,
  intervalMs: PositiveFiniteSchema,
  billingIntervalMs: Schema.optionalKey(PositiveFiniteSchema),
  providers: Schema.Array(Schema.Struct({
    id: ProviderIdSchema,
    name: Schema.String,
    color: Schema.String,
  })),
  accounts: Schema.Array(WebAccountSchema),
  seeded: Schema.Boolean,
  peak: Schema.NullOr(Schema.Struct({
    state: Schema.Literals(['peak', 'off-peak', 'weekend'] as const),
    label: Schema.String,
    // The upstream clock is only normalized to a finite number; do not make
    // the wire contract narrower than the producer's declared type.
    minutesUntilChange: Schema.NullOr(Schema.Finite),
    changesAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  })),
})

const EmptyPayloadSchema = Schema.Struct({})

export const GetConfigRpc = Rpc.make(TOKMON_WS_METHODS.getConfig, {
  payload: EmptyPayloadSchema,
  success: ConfigStateSchema,
})

export const SetConfigRpc = Rpc.make(TOKMON_WS_METHODS.setConfig, {
  payload: ConfigUpdateRequestSchema,
  success: ConfigStateSchema,
  error: Schema.Union([ConfigUpdateConflictSchema, ConfigPersistenceFailureSchema]),
})

export const RefreshRpc = Rpc.make(TOKMON_WS_METHODS.refresh, {
  payload: Schema.Struct({ scope: RefreshScopeSchema }),
  success: Schema.Void,
})

export const BrowseFsRpc = Rpc.make(TOKMON_WS_METHODS.browseFs, {
  payload: Schema.Struct({ path: Schema.String }),
  success: FsListingSchema,
})

export const SnapshotRpc = Rpc.make(TOKMON_WS_METHODS.snapshot, {
  payload: EmptyPayloadSchema,
  success: WebSnapshotSchema,
  stream: true,
})

export const ConfigRpc = Rpc.make(TOKMON_WS_METHODS.config, {
  payload: EmptyPayloadSchema,
  success: ConfigStateSchema,
  stream: true,
})

export const TokmonRpcGroup = RpcGroup.make(
  GetConfigRpc,
  SetConfigRpc,
  RefreshRpc,
  BrowseFsRpc,
  SnapshotRpc,
  ConfigRpc,
)
