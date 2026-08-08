import { Option, Schema } from 'effect'
import { WebSnapshotSchema } from '../rpc/contract'
import type { WebSnapshot } from './contract'
import { materializeWebSnapshot } from './snapshot-materialize'

export { materializeWebSnapshot } from './snapshot-materialize'

const decodeWireSnapshot = Schema.decodeUnknownOption(WebSnapshotSchema)

export function decodeWebSnapshot(value: unknown): WebSnapshot | null {
  return Option.map(decodeWireSnapshot(value), materializeWebSnapshot).pipe(Option.getOrNull)
}
