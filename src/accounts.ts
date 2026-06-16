import { type Config, expandHome } from './config'
import { PROVIDER_ORDER, PROVIDERS } from './providers'
import type { Account, ProviderId } from './providers/types'

export function buildAccounts(config: Config, detected: ProviderId[]): Account[] {
  const out: Account[] = []
  for (const pid of PROVIDER_ORDER) {
    if (config.disabledProviders.includes(pid)) continue
    const provider = PROVIDERS[pid]
    const configured = config.accounts.filter(a => a.providerId === pid)
    if (configured.length > 0) {
      for (const a of configured) {
        out.push({
          id: a.id,
          providerId: pid,
          name: a.name,
          color: a.color || provider.color,
          homeDir: a.homeDir && a.homeDir !== '~' ? expandHome(a.homeDir) : undefined,
        })
      }
    } else if (detected.includes(pid)) {
      out.push({ id: pid, providerId: pid, name: provider.name, color: provider.color, homeDir: undefined })
    }
  }
  return out
}

export function accountsByProvider(accounts: Account[]): { provider: ProviderId; accounts: Account[] }[] {
  const groups: { provider: ProviderId; accounts: Account[] }[] = []
  for (const pid of PROVIDER_ORDER) {
    const list = accounts.filter(a => a.providerId === pid)
    if (list.length > 0) groups.push({ provider: pid, accounts: list })
  }
  return groups
}
