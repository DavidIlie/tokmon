export type TabKey = 'overview' | 'analytics' | 'models' | 'explore'

export const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'overview' },
  { key: 'analytics', label: 'analytics' },
  { key: 'models', label: 'models' },
  { key: 'explore', label: 'explore' },
]
