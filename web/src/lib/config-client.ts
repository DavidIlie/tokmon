import { describeConfigUpdateFailure, repairConfig, type AppearanceMode, type Config, type ConfigState } from '@shared'
import { daemonRpcClient } from './rpc-client'

interface ConfigWriter {
  setConfig(update: { config: Config; expectedRevision: number }): Promise<ConfigState>
}

function repairedState(state: ConfigState): ConfigState {
  return { ...state, config: repairConfig(state.config).config }
}

export async function getConfig(): Promise<ConfigState> {
  return repairedState(await daemonRpcClient().getConfig())
}

export async function putConfig(
  config: Config,
  expectedRevision: number,
  writer: ConfigWriter = daemonRpcClient(),
): Promise<ConfigState> {
  return repairedState(await writer.setConfig({ config, expectedRevision }))
}

/**
 * Persist the user's desired privacy state from the latest subscribed revision.
 * A conflict retries once from the daemon-returned document while preserving the
 * desired boolean, so a concurrent privacy write cannot accidentally be toggled
 * back by an invert-the-latest retry.
 */
export async function togglePrivacyMode(
  subscribed: ConfigState,
  writer: ConfigWriter = daemonRpcClient(),
): Promise<ConfigState> {
  const current = repairedState(subscribed)
  const desired = !current.config.privacyMode
  try {
    return await putConfig(
      { ...current.config, privacyMode: desired },
      current.config.revision,
      writer,
    )
  } catch (error) {
    const conflict = describeConfigUpdateFailure(error).conflictState
    if (!conflict) throw error
    const latest = repairedState(conflict)
    if (latest.config.privacyMode === desired) return latest
    return putConfig(
      { ...latest.config, privacyMode: desired },
      latest.config.revision,
      writer,
    )
  }
}

/** Persist only the requested graphical mode. A CAS conflict is rebased onto
 * the daemon document so a toolbar click cannot overwrite a dirty settings save. */
export async function setAppearanceMode(
  subscribed: ConfigState,
  desired: AppearanceMode,
  writer: ConfigWriter = daemonRpcClient(),
): Promise<ConfigState> {
  const current = repairedState(subscribed)
  const update = (base: ConfigState) => putConfig({
    ...base.config,
    appearance: { ...base.config.appearance, mode: desired },
  }, base.config.revision, writer)
  try {
    return await update(current)
  } catch (error) {
    const conflict = describeConfigUpdateFailure(error).conflictState
    if (!conflict) throw error
    const latest = repairedState(conflict)
    if (latest.config.appearance.mode === desired) return latest
    return update(latest)
  }
}

export function configStateFromUpdateFailure(error: unknown): ConfigState | null {
  const state = describeConfigUpdateFailure(error).conflictState
  return state ? repairedState(state) : null
}

export interface FsEntry { name: string; path: string; dir: boolean }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[] }

export async function listDir(path: string): Promise<FsListing> {
  return daemonRpcClient().browseFs(path) as unknown as Promise<FsListing>
}

export function subscribeConfig(onConfig: (state: ConfigState) => void): () => void {
  return daemonRpcClient().subscribeConfig((state) => {
    onConfig(repairedState(state))
  })
}

export async function refreshAllData(): Promise<void> {
  return daemonRpcClient().refresh('all')
}
