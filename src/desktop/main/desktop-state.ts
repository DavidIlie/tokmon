import type { WebContents } from 'electron'
import type { Config } from '../../config-schema'
import type { WebSnapshot } from '../../web/contract'
import { DESKTOP_CHANNELS, type DesktopConnectionState, type DesktopState, type DesktopUpdateState } from '../shared/desktop-contract'
import { disabledUpdateState } from './desktop-updater'
import { effectiveSystemMode } from './native-theme'

export class DesktopStateStore {
  private readonly targets = new Set<WebContents>()
  private value: DesktopState

  constructor(appName = 'Tokmon', appVersion = '0.0.0', role: DesktopState['daemonRole'] = null) {
    this.value = {
      appName,
      appVersion,
      update: disabledUpdateState(),
      snapshot: null,
      config: null,
      configRevision: null,
      connection: 'connecting',
      daemonRole: role,
      platform: process.platform,
      systemMode: effectiveSystemMode(false),
      activeAccountIds: [],
      error: null,
    }
  }

  get(): DesktopState { return this.value }

  addTarget(contents: WebContents): () => void {
    this.targets.add(contents)
    contents.once('destroyed', () => this.targets.delete(contents))
    return () => this.targets.delete(contents)
  }

  update(patch: Partial<DesktopState>): DesktopState {
    this.value = { ...this.value, ...patch }
    for (const target of this.targets) {
      if (!target.isDestroyed()) target.send(DESKTOP_CHANNELS.state, this.value)
    }
    return this.value
  }

  snapshot(snapshot: WebSnapshot): void { this.update({ snapshot, error: null }) }

  config(config: Config, revision: number): void {
    // A successful setConfig is observed both through the daemon subscription
    // and its RPC response. Whichever arrives first is authoritative; do not
    // make the renderer reconcile the same revision twice.
    if (this.value.configRevision === revision && this.value.error === null) return
    this.update({ config, configRevision: revision, error: null })
  }

  updater(update: DesktopUpdateState): void { this.update({ update }) }

  connection(connection: DesktopConnectionState, error?: unknown): void {
    this.update({
      connection,
      error: error instanceof Error ? error.message : error ? String(error) : null,
    })
  }
}
