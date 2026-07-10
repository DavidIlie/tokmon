import type { Filters } from './derive.filters'

export interface AvailableFilters {
  providers: ReadonlySet<string>
  accounts: ReadonlySet<string>
  models: ReadonlySet<string>
  modelsReady: boolean
}

export function cleanUnavailableFilters(filters: Filters, available: AvailableFilters): Filters {
  const providers = filters.providers.filter(provider => available.providers.has(provider))
  const account = filters.account === 'all' || available.accounts.has(filters.account) ? filters.account : 'all'
  const models = available.modelsReady
    ? filters.models.filter(model => available.models.has(model))
    : filters.models

  if (
    providers.length === filters.providers.length &&
    models.length === filters.models.length &&
    account === filters.account
  ) return filters

  return { ...filters, providers, account, models }
}
