import { repairConfig, type Config } from '@shared'
import { daemonRpcClient } from './rpc-client'

export async function getConfig(): Promise<Config> {
  return repairConfig(await daemonRpcClient().getConfig()).config
}

export async function putConfig(config: Config): Promise<Config> {
  return repairConfig(await daemonRpcClient().setConfig(config)).config
}

export interface FsEntry { name: string; path: string; dir: boolean }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[] }

export async function listDir(path: string): Promise<FsListing> {
  return daemonRpcClient().browseFs(path) as unknown as Promise<FsListing>
}

export function subscribeConfig(onConfig: (c: Config) => void): () => void {
  return daemonRpcClient().subscribeConfig((config) => {
    onConfig(repairConfig(config).config)
  })
}
