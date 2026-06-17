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
  const accounts = snapshot?.accounts.filter(a => a.hasUsage) ?? []
  const activeProv = (id: string) => filters.providers.length === 0 || filters.providers.includes(id)

  const toggleProvider = (id: string) => setFilters(f => {
    const has = f.providers.includes(id)
    return { ...f, providers: has ? f.providers.filter(p => p !== id) : [...f.providers, id] }
  })

  const anyFilter = filters.providers.length > 0 || filters.models.length > 0 || filters.account !== 'all'

  return (
    <div className="border-t border-line bg-bg-0/70">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
        <span className="text-xs text-fg-faint">filter:</span>

        <div className="flex flex-wrap items-center gap-1.5">
          {providers.map(p => {
            const on = filters.providers.includes(p.id)
            const dim = filters.providers.length > 0 && !on
            return (
              <button
                key={p.id}
                onClick={() => toggleProvider(p.id)}
                className={`flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs transition ${
                  on ? 'bg-bg-2' : 'bg-transparent hover:border-line-2'
                }`}
                style={{
                  borderColor: on ? p.color : 'var(--color-line)',
                  color: dim ? 'var(--color-fg-faint)' : on ? p.color : 'var(--color-fg-dim)',
                }}
                title={activeProv(p.id) ? `hide ${p.name}` : `show only ${p.name}`}
              >
                <span style={{ color: p.color, opacity: dim ? 0.4 : 1 }}>●</span>
                {p.name}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {accounts.length > 1 && (
            <Dropdown label="account" value={filters.account === 'all' ? 'All' : (accounts.find(a => a.id === filters.account)?.name ?? 'All')}>
              {close => (
                <Menu>
                  <MenuItem active={filters.account === 'all'} onClick={() => { setFilters(f => ({ ...f, account: 'all' })); close() }}>All accounts</MenuItem>
                  {accounts.map(a => (
                    <MenuItem key={a.id} active={filters.account === a.id} onClick={() => { setFilters(f => ({ ...f, account: a.id })); close() }}>
                      <span style={{ color: a.color }}>●</span> {a.name}
                    </MenuItem>
                  ))}
                </Menu>
              )}
            </Dropdown>
          )}

          <Dropdown label="model" value={filters.models.length === 0 ? 'all' : filters.models.length === 1 ? shortModel(filters.models[0]) : `${filters.models.length} models`}>
            {() => (
              <Menu>
                <MenuItem active={filters.models.length === 0} onClick={() => setFilters(f => ({ ...f, models: [] }))}>All models</MenuItem>
                <div className="my-1 h-px bg-line" />
                <div className="max-h-64 overflow-y-auto">
                  {derived.modelOptions.length === 0 && <div className="px-2 py-1 text-xs text-fg-faint">no models in range</div>}
                  {derived.modelOptions.map(m => {
                    const on = filters.models.includes(m)
                    return (
                      <MenuItem key={m} active={on} onClick={() => setFilters(f => ({
                        ...f, models: on ? f.models.filter(x => x !== m) : [...f.models, m],
                      }))}>
                        <span className={on ? 'text-accent' : 'text-fg-faint'}>{on ? '◉' : '○'}</span> {shortModel(m)}
                      </MenuItem>
                    )
                  })}
                </div>
              </Menu>
            )}
          </Dropdown>

          <Segmented
            options={PERIODS.map(p => ({ value: p.key, label: p.key === 'mtd' ? 'MTD' : p.key === 'all' ? 'ALL' : p.key }))}
            value={filters.period}
            onChange={period => setFilters(f => ({ ...f, period }))}
            size="sm"
          />

          {anyFilter && (
            <button
              onClick={() => setFilters(f => ({ ...f, providers: [], models: [], account: 'all' }))}
              className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-fg-faint transition hover:border-warning/60 hover:text-warning"
              title="Clear filters"
            >
              <X className="size-3" /> clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

