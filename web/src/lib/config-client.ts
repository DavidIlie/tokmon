import { normalizeConfig, type Config } from '@shared'
import { daemonRpcClient } from './rpc-client'

export async function getConfig(): Promise<Config> {
  return normalizeConfig(await daemonRpcClient().getConfig() as unknown as Record<string, unknown>)
}

export async function putConfig(config: Config): Promise<Config> {
  return normalizeConfig(await daemonRpcClient().setConfig(config) as unknown as Record<string, unknown>)
}

export interface FsEntry { name: string; path: string; dir: boolean }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[] }

export async function listDir(path: string): Promise<FsListing> {
  return daemonRpcClient().browseFs(path) as unknown as Promise<FsListing>
}

export function subscribeConfig(onConfig: (c: Config) => void): () => void {
  return daemonRpcClient().subscribeConfig((config) => {
    onConfig(normalizeConfig(config as unknown as Record<string, unknown>))
  })
}
