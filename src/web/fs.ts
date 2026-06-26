import { readdir, stat, realpath } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve as resolvePath, isAbsolute, sep } from 'node:path'
import { expandHome } from '../config'

export interface FsEntry { name: string; path: string; dir: boolean }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[] }

function isContained(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep)
}

function parentFor(root: string, abs: string): string | null {
  const parentResolved = resolvePath(abs, '..')
  return abs === root || !isContained(root, parentResolved) ? null : parentResolved
}

export async function listHomeDirectory(rawPath: string): Promise<FsListing> {
  const root = resolvePath(homedir())
  const expanded = expandHome(rawPath || '~')
  const requested = isAbsolute(expanded) ? resolvePath(expanded) : resolvePath(root, expanded)
  const lexical = isContained(root, requested) ? requested : root

  let real: string
  try { real = await realpath(lexical) } catch { real = lexical }
  const abs = isContained(root, real) ? real : root

  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await stat(abs)
  } catch {
    return { path: abs, parent: parentFor(root, abs), entries: [] }
  }
  if (!st.isDirectory()) return { path: abs, parent: parentFor(root, abs), entries: [] }

  let dirents: Dirent<string>[]
  try {
    dirents = await readdir(abs, { withFileTypes: true })
  } catch {
    return { path: abs, parent: parentFor(root, abs), entries: [] }
  }
  const entries: FsEntry[] = []
  for (const d of dirents) {
    if (d.name.startsWith('.')) continue
    let dir = d.isDirectory()
    const full = join(abs, d.name)
    if (d.isSymbolicLink()) {
      let real: string
      try { real = await realpath(full) } catch { continue }
      if (!isContained(root, real)) continue
      try { dir = (await stat(full)).isDirectory() } catch { continue }
    }
    entries.push({ name: d.name, path: full, dir })
  }

  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))

  return { path: abs, parent: parentFor(root, abs), entries }
}
