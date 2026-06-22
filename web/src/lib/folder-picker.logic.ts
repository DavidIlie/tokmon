export interface FolderPickerEntry {
  name: string
  path: string
  dir: boolean
}

export interface FolderPickerListing {
  path: string
  parent: string | null
  entries: FolderPickerEntry[]
}

export type FolderPickerRow =
  | { kind: 'parent'; key: '..'; label: '..'; path: string }
  | { kind: 'entry'; key: string; label: string; path: string }

export function normalizeBrowseStartPath(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : '~'
}

export function isRootPath(value: string): boolean {
  return value === '/' || value === '~'
}

export function trimTrailingPathSeparators(value: string): string {
  if (value.length === 0 || isRootPath(value)) return value
  const trimmed = value.replace(/\/+$/g, '')
  return trimmed.length === 0 ? value : trimmed
}

export function hasTrailingPathSeparator(value: string): boolean {
  return /\/$/.test(value) && value !== '/'
}

function ensureTrailingSeparator(value: string): string {
  if (value === '/' || value.endsWith('/')) return value
  return `${value}/`
}

export function getBrowseDirectoryPath(currentPath: string): string {
  const trimmed = currentPath.trim()
  if (trimmed.length === 0 || hasTrailingPathSeparator(trimmed)) return trimmed
  const lastSeparatorIndex = trimmed.lastIndexOf('/')
  if (lastSeparatorIndex < 0) return trimmed
  return trimmed.slice(0, lastSeparatorIndex + 1)
}

export function getBrowseLeafPathSegment(currentPath: string): string {
  const trimmed = trimTrailingPathSeparators(currentPath.trim())
  const lastSeparatorIndex = trimmed.lastIndexOf('/')
  return lastSeparatorIndex < 0 ? trimmed : trimmed.slice(lastSeparatorIndex + 1)
}

export function appendBrowsePathSegment(currentPath: string, segment: string): string {
  const base = normalizeBrowseStartPath(getBrowseDirectoryPath(currentPath))
  const normalizedBase = base === '~' ? '~/' : ensureTrailingSeparator(base)
  return `${normalizedBase}${segment}/`
}

export function getBrowseParentPath(currentPath: string): string | null {
  const trimmed = trimTrailingPathSeparators(currentPath.trim())
  if (!trimmed || trimmed === '/' || trimmed === '~') return null

  if (trimmed.startsWith('~/')) {
    const rest = trimmed.slice(2)
    if (!rest) return '~'
    const segments = rest.split('/').filter(Boolean)
    if (segments.length <= 1) return '~/'
    return `~/${segments.slice(0, -1).join('/')}/`
  }

  const lastSeparatorIndex = trimmed.lastIndexOf('/')
  if (lastSeparatorIndex < 0) return null
  if (lastSeparatorIndex === 0) return '/'
  return trimmed.slice(0, lastSeparatorIndex + 1)
}

export function canNavigateUp(currentPath: string): boolean {
  return hasTrailingPathSeparator(currentPath) && getBrowseParentPath(currentPath) !== null
}

export function displayFolderPath(path: string | null | undefined): string {
  const trimmed = (path ?? '').trim()
  return trimmed.length > 0 ? trimmed : '~'
}

export function rowsForListing(listing: FolderPickerListing): FolderPickerRow[] {
  const rows: FolderPickerRow[] = []
  if (listing.parent !== null) {
    rows.push({ kind: 'parent', key: '..', label: '..', path: listing.parent })
  }
  for (const entry of [...listing.entries]
    .filter((item) => item.dir)
    .sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push({
      kind: 'entry',
      key: entry.path,
      label: entry.name,
      path: entry.path,
    })
  }
  return rows
}
