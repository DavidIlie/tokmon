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
    // Every send serializes the full state — including the snapshot — across
    // the IPC boundary into the always-alive renderer. Presentation repaints
    // call update() with values that are usually unchanged; skip those sends.
    if (!this.patchChangesValue(patch)) return this.value
    this.value = { ...this.value, ...patch }
    for (const target of this.targets) {
      if (!target.isDestroyed()) target.send(DESKTOP_CHANNELS.state, this.value)
    }
    return this.value
  }

  private patchChangesValue(patch: Partial<DesktopState>): boolean {
    for (const key of Object.keys(patch) as (keyof DesktopState)[]) {
      const next = patch[key]
      const prev = this.value[key]
      if (next === prev) continue
      // activeAccountIds is rebuilt per repaint; treat same-content as unchanged.
      if (
        key === 'activeAccountIds'
        && Array.isArray(next) && Array.isArray(prev)
        && next.length === prev.length
        && next.every((id, index) => id === prev[index])
      ) continue
      return true
    }
    return false
  }

  snapshot(snapshot: WebSnapshot): void { this.update({ snapshot: projectSnapshotForPopover(snapshot), error: null }) }

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

/**
 * The popover reads `table` only as a has-history boolean (provider-card.tsx,
 * desktop-settings.tsx); shipping every account's full daily/weekly/monthly
 * per-model breakdown across IPC into the always-alive renderer multiplies the
 * app's working set for data no surface renders. Keep one sentinel row per
 * non-empty granularity so the boolean checks stay truthful.
 */
export function projectSnapshotForPopover(snapshot: WebSnapshot): WebSnapshot {
  let changed = false
  const accounts = snapshot.accounts.map(account => {
    const table = account.table
    if (!table) return account
    const daily = table.daily.length
    const weekly = table.weekly.length
    const monthly = table.monthly.length
    if (daily <= 1 && weekly <= 1 && monthly <= 1) return account
    changed = true
    return {
      ...account,
      table: {
        daily: table.daily.slice(0, 1),
        weekly: table.weekly.slice(0, 1),
        monthly: table.monthly.slice(0, 1),
      },
    }
  })
  return changed ? { ...snapshot, accounts } : snapshot
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
