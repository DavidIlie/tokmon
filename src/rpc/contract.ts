import { Schema } from 'effect'
import * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import type { Config } from '../config-schema'
import { PROVIDER_IDS } from '../providers/types'
import type { WebSnapshot } from '../web/contract'

export const TOKMON_WS_PATH = '/ws'

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

export const ProviderIdSchema = Schema.Literals(PROVIDER_IDS)

export const AccountSchema = Schema.Struct({
  id: Schema.String,
  providerId: ProviderIdSchema,
  name: Schema.String,
  homeDir: Schema.String,
  color: Schema.optionalKey(Schema.String),
})

type RuntimeSchema<T> = Schema.Codec<T, T, never, never> & {
  readonly '~type.make.in': T
}

const jsonSafePassthrough = <T>() => Schema.Unknown as unknown as RuntimeSchema<T>

export const ConfigSchema = (Schema.Struct({
  interval: Schema.Number,
  billingInterval: Schema.Number,
  clearScreen: Schema.Boolean,
  timezone: Schema.NullOr(Schema.String),
  accounts: Schema.mutable(Schema.Array(AccountSchema)),
  activeAccountId: Schema.NullOr(Schema.String),
  disabledProviders: Schema.mutable(Schema.Array(ProviderIdSchema)),
  onboarded: Schema.Boolean,
  dashboardLayout: Schema.Literals(['grid', 'single'] as const),
  defaultFocus: Schema.Literals(['all', 'last'] as const),
  ascii: Schema.Literals(['auto', 'on', 'off'] as const),
  knownProviders: Schema.mutable(Schema.Array(ProviderIdSchema)),
}) as unknown) as RuntimeSchema<Config>

export const ConfigResultSchema = jsonSafePassthrough<Config>()

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

export const WebSnapshotSchema = jsonSafePassthrough<WebSnapshot>()

const EmptyPayloadSchema = Schema.Struct({})

export const GetConfigRpc = Rpc.make(TOKMON_WS_METHODS.getConfig, {
  payload: EmptyPayloadSchema,
  success: ConfigResultSchema,
})

export const SetConfigRpc = Rpc.make(TOKMON_WS_METHODS.setConfig, {
  payload: ConfigSchema,
  success: ConfigResultSchema,
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
  success: ConfigResultSchema,
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
