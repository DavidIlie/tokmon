import type { WebSnapshot } from '@shared'
import { PERIODS, type Derived, type Filters } from '../lib/derive'
import { shortModel } from '../lib/colors'
import { X } from './icons'
import { Dropdown, Menu, MenuItem, Segmented } from './ui'

export function FilterBar({ snapshot, derived, filters, setFilters }: {
  snapshot: WebSnapshot | null
  derived: Derived
  filters: Filters
  setFilters: (next: Filters | ((p: Filters) => Filters)) => void
}) {
  const providers = snapshot?.providers ?? []
  const accounts = snapshot?.accounts ?? []
  const usageAccounts = accounts.filter(a => a.hasUsage)
  const usageProviderIds = new Set(usageAccounts.map(a => a.providerId))

  // Only usage providers are filter chips — a billing-only chip would blank every chart.
  const chipProviders = providers.filter(p => usageProviderIds.has(p.id))
  const billingProviders = providers.filter(p =>
    !usageProviderIds.has(p.id) && accounts.some(a => a.providerId === p.id && a.hasBilling))

  const provName = (id: string) => providers.find(p => p.id === id)?.name ?? id
  const acctLabel = (a: { providerId: string; name: string }) =>
    a.name && a.name !== provName(a.providerId) ? `${provName(a.providerId)} · ${a.name}` : provName(a.providerId)
  const selectedAccount = usageAccounts.find(a => a.id === filters.account)

  const handleToggleProvider = (id: string) => setFilters(f => {
    const has = f.providers.includes(id)
    return { ...f, providers: has ? f.providers.filter(p => p !== id) : [...f.providers, id] }
  })

  const anyFilter = filters.providers.length > 0 || filters.models.length > 0 || filters.account !== 'all'

  return (
    <div className="border-t border-line bg-bg-0/70">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 2xl:max-w-[1920px]">
        <span className="hidden text-xs text-fg-faint sm:inline">filter:</span>

        <div className="flex flex-wrap items-center gap-1.5">
          {chipProviders.map(p => {
            const on = filters.providers.includes(p.id)
            const dim = filters.providers.length > 0 && !on
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => handleToggleProvider(p.id)}
                className="flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent max-sm:py-1.5"
                style={{
                  borderColor: on ? p.color : 'var(--color-line)',
                  color: dim ? 'var(--color-fg-faint)' : on ? p.color : 'var(--color-fg-dim)',
                  background: on ? 'var(--color-bg-2)' : 'transparent',
                }}
                title={on ? `hide ${p.name}` : filters.providers.length ? `add ${p.name}` : `show only ${p.name}`}
              >
                <span style={{ color: p.color, opacity: dim ? 0.4 : 1 }} aria-hidden>{on ? '●' : '○'}</span>
                {p.name}
              </button>
            )
          })}
          {billingProviders.length > 0 && (
            <span
              className="flex items-center gap-1.5 text-xs text-fg-faint"
              title="Billing-only providers — shown as cards with plan & quota; no usage timeline to filter"
            >
              {chipProviders.length > 0 && <span className="text-line-2">|</span>}
              <span>billing-only:</span>
              {billingProviders.map(p => (
                <span key={p.id} className="flex items-center gap-1 text-fg-dim">
                  <span style={{ color: p.color, opacity: 0.55 }} aria-hidden>·</span>{p.name}
                </span>
              ))}
            </span>
          )}
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
          {usageAccounts.length > 1 ? (
            <Dropdown label="account" value={filters.account === 'all' ? 'all' : (selectedAccount ? acctLabel(selectedAccount) : 'all')}>
              {close => (
                <Menu>
                  <MenuItem active={filters.account === 'all'} onClick={() => { setFilters(f => ({ ...f, account: 'all' })); close() }}>
                    All accounts
                  </MenuItem>
                  <div className="my-1 h-px bg-line" />
                  <div className="max-h-64 overflow-y-auto">
                    {usageAccounts.map(a => (
                      <MenuItem key={a.id} active={filters.account === a.id} onClick={() => { setFilters(f => ({ ...f, account: a.id })); close() }}>
                        <span style={{ color: a.color }} aria-hidden>●</span> <span className="truncate">{acctLabel(a)}</span>
                      </MenuItem>
                    ))}
                  </div>
                </Menu>
              )}
            </Dropdown>
          ) : usageAccounts.length === 1 ? (
            <span className="rounded border border-line bg-bg-1 px-2 py-1 text-xs text-fg-dim">
              account: <span className="text-fg">{acctLabel(usageAccounts[0])}</span>
            </span>
          ) : null}

          <Dropdown
            label="model"
            value={filters.models.length === 0 ? 'all' : filters.models.length === 1 ? shortModel(filters.models[0]) : `${filters.models.length} models`}
          >
            {() => (
              <Menu>
                <MenuItem active={filters.models.length === 0} onClick={() => setFilters(f => ({ ...f, models: [] }))}>
                  All models
                </MenuItem>
                <div className="my-1 h-px bg-line" />
                <div className="max-h-64 overflow-y-auto">
                  {derived.modelOptions.length === 0 && (
                    <div className="px-2 py-1 text-xs text-fg-faint">no models in range</div>
                  )}
                  {derived.modelOptions.map(m => {
                    const on = filters.models.includes(m)
                    return (
                      <MenuItem key={m} active={on} onClick={() => setFilters(f => ({
                        ...f, models: on ? f.models.filter(x => x !== m) : [...f.models, m],
                      }))}>
                        <span className={on ? 'text-accent' : 'text-fg-faint'} aria-hidden>{on ? '◉' : '○'}</span> {shortModel(m)}
                      </MenuItem>
                    )
                  })}
                </div>
              </Menu>
            )}
          </Dropdown>

          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-xs text-fg-faint">range:</span>
            <Segmented
              options={PERIODS.map(p => ({ value: p.key, label: p.key === 'mtd' ? 'MTD' : p.key === 'all' ? 'ALL' : p.key }))}
              value={filters.period}
              onChange={period => setFilters(f => ({ ...f, period }))}
              size="sm"
              ariaLabel="time range"
            />
          </div>

          {anyFilter && (
            <button
              type="button"
              onClick={() => setFilters(f => ({ ...f, providers: [], models: [], account: 'all' }))}
              className="flex items-center gap-1 rounded border border-line bg-bg-1 px-2 py-1 text-xs text-fg-faint transition hover:border-warning/60 hover:text-warning focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              title="Clear provider, model & account filters"
              aria-label="Clear provider, model and account filters"
            >
              <X className="size-3" aria-hidden /> clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
