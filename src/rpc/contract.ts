import { Schema } from 'effect'
import * as Rpc from 'effect/unstable/rpc/Rpc'
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup'
import type { Config } from '../config-schema'
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

type RuntimeSchema<T> = Schema.Codec<T, T, never, never> & {
  readonly '~type.make.in': T
}

const jsonSafePassthrough = <T>() => Schema.Unknown as unknown as RuntimeSchema<T>

export const ConfigSchema = jsonSafePassthrough<Config>()
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
