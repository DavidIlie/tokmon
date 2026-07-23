import type { WebContents } from 'electron'
import type { Config } from '../../config-schema'
import type { WebSnapshot } from '../../web/contract'
import { DESKTOP_CHANNELS, type DesktopConnectionState, type DesktopState, type DesktopUpdateState, type TrayStripPayload } from '../shared/desktop-contract'
import { menuBarDisplayBucket, menuBarRenderSignature, menuBarValuesFromSnapshot } from '../shared/menu-bar-plan'
import { disabledUpdateState } from './desktop-updater'
import { effectiveSystemMode } from './native-theme'

export class DesktopStateStore {
  private readonly targets = new Set<WebContents>()
  private value: DesktopState

  constructor(appName = 'Tokmon', appVersion = '0.0.0', daemon: DesktopState['daemon'] = null, displayWidthPt = 1440) {
    this.value = {
      appName,
      appVersion,
      update: disabledUpdateState(),
      loginItem: { status: 'development', enabled: false, error: null },
      snapshot: null,
      config: null,
      configRevision: null,
      connection: 'connecting',
      daemon,
      platform: process.platform,
      displayWidthPt,
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

/** Reject renderer pixels produced from any superseded presentation input. */
export function trayStripPayloadMatchesState(
  payload: TrayStripPayload,
  state: DesktopState,
  pinSignature: string,
): boolean {
  if (!state.config || !state.snapshot || !pinSignature) return false
  const expectedSignature = menuBarRenderSignature({
    configRevision: state.configRevision ?? state.config.revision,
    snapshotGeneratedAt: state.snapshot.generatedAt,
    values: menuBarValuesFromSnapshot(state.snapshot, state.config, pinSignature.split(String.fromCharCode(0))),
    config: state.config.tray.menuBar,
    valueMode: state.config.tray.menuBarValue,
    displayWidthPt: state.displayWidthPt,
    updateReady: state.update.status === 'downloaded',
    updateStatus: state.update.status,
  })
  return payload.updateReady === (state.update.status === 'downloaded')
    && payload.configRevision === state.configRevision
    && payload.snapshotGeneratedAt === state.snapshot?.generatedAt
    && payload.pinSignature === pinSignature
    && pinSignature.length > 0
    && menuBarDisplayBucket(payload.displayWidthPt) === menuBarDisplayBucket(state.displayWidthPt)
    && payload.renderSignature === expectedSignature
}
