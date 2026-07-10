import { repairConfig, type Config } from '@shared'
import { daemonRpcClient } from './rpc-client'
import type { ConfigState } from '../../../src/rpc/contract'

export async function getConfig(): Promise<ConfigState> {
  const state = await daemonRpcClient().getConfig()
  return { ...state, config: repairConfig(state.config).config }
}

export async function putConfig(config: Config, expectedRevision: number): Promise<ConfigState> {
  const state = await daemonRpcClient().setConfig({ config, expectedRevision })
  return { ...state, config: repairConfig(state.config).config }
}

export interface FsEntry { name: string; path: string; dir: boolean }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[] }

export async function listDir(path: string): Promise<FsListing> {
  return daemonRpcClient().browseFs(path) as unknown as Promise<FsListing>
}

export function subscribeConfig(onConfig: (state: ConfigState) => void): () => void {
  return daemonRpcClient().subscribeConfig((state) => {
    onConfig({ ...state, config: repairConfig(state.config).config })
  })
}
