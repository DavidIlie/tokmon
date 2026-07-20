import type { Config } from '../../web/contract'
import type { DesktopState } from '../shared/desktop-contract'

export type ConfigMutation = (config: Config) => Config

interface PendingMutation {
  id: number
  mutate: ConfigMutation
  baseRevision: number | null
  submitted: Config | null
}

function sameSubmittedConfig(left: Config, right: Config): boolean {
  return JSON.stringify({ ...left, revision: 0 }) === JSON.stringify({ ...right, revision: 0 })
}

/**
 * Reconciles daemon snapshots with queued optimistic config writes.
 *
 * A daemon update only consumes a pending mutation when its next revision has
 * the exact submitted value. Unrelated config writes therefore cannot erase a
 * local optimistic state while the CAS retry is still in flight.
 */
export class OptimisticConfigUpdates {
  private authoritative: DesktopState | null = null
  private pending: PendingMutation[] = []
  private snapshotsByPrivacy = new Map<boolean, DesktopState['snapshot']>()
  private nextId = 1

  accept(state: DesktopState): DesktopState {
    this.authoritative = state
    const snapshotPrivacy = this.snapshotPrivacy(state)
    if (snapshotPrivacy !== null) this.snapshotsByPrivacy.set(snapshotPrivacy, state.snapshot)
    return this.project()
  }

  enqueue(mutate: ConfigMutation): { id: number; state: DesktopState | null } {
    const id = this.nextId++
    this.pending.push({ id, mutate, baseRevision: null, submitted: null })
    return { id, state: this.authoritative ? this.project() : null }
  }

  begin(id: number, state: DesktopState): { config: Config; state: DesktopState } {
    this.authoritative = state
    const pending = this.require(id)
    if (!state.config || state.configRevision === null) throw new Error('config unavailable')
    pending.baseRevision = state.configRevision
    pending.submitted = pending.mutate(structuredClone(state.config))
    return { config: pending.submitted, state: this.project() }
  }

  complete(id: number, state: DesktopState): DesktopState {
    this.authoritative = state
    this.remove(id)
    return this.project()
  }

  fail(id: number, state: DesktopState): DesktopState {
    this.authoritative = state
    this.remove(id)
    return this.project()
  }

  cancel(id: number): DesktopState | null {
    this.remove(id)
    return this.authoritative ? this.project() : null
  }

  private project(): DesktopState {
    const state = this.authoritative!
    if (!state.config) return state
    let config = state.config
    for (const pending of this.pending) {
      if (this.isAccepted(pending, state)) continue
      config = pending.mutate(structuredClone(config))
    }
    const snapshot = this.snapshotFor(config.privacyMode, state)
    return config === state.config && snapshot === state.snapshot ? state : { ...state, config, snapshot }
  }

  private snapshotFor(privacy: boolean, state: DesktopState): DesktopState['snapshot'] {
    const mode = this.snapshotPrivacy(state)
    return mode === null || mode === privacy
      ? state.snapshot
      : (this.snapshotsByPrivacy.get(privacy) ?? state.snapshot)
  }

  private snapshotPrivacy(state: DesktopState): boolean | null {
    const accounts = state.snapshot?.accounts ?? []
    if (accounts.some(account => account.identity?.redacted === true)) return true
    if (accounts.some(account => Boolean(account.email && account.identity))) return false
    return null
  }

  private isAccepted(pending: PendingMutation, state: DesktopState): boolean {
    return pending.baseRevision !== null
      && pending.submitted !== null
      && state.config !== null
      && state.configRevision === pending.baseRevision + 1
      && sameSubmittedConfig(state.config, pending.submitted)
  }

  private require(id: number): PendingMutation {
    const pending = this.pending.find(candidate => candidate.id === id)
    if (!pending) throw new Error(`unknown pending config update ${id}`)
    return pending
  }

  private remove(id: number): void {
    this.pending = this.pending.filter(candidate => candidate.id !== id)
  }
}
