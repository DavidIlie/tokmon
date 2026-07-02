import { accessSync, constants, existsSync } from 'node:fs'
import { join, delimiter, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import type { ProviderId } from './types'

function searchDirs(): string[] {
  const home = homedir()
  const fromEnv = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const extra = process.platform === 'win32'
    ? [
        process.env.APPDATA && join(process.env.APPDATA, 'npm'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'pnpm'),
        join(home, 'scoop', 'shims'),
      ]
    : [
        '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/opt/local/bin',
        join(home, '.local', 'bin'), join(home, 'bin'),
        join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'),
        join(home, '.local', 'share', 'pnpm'),
      ]
  return [...new Set([...fromEnv, ...extra.filter((d): d is string => !!d)])]
}

function isExec(p: string): boolean {
  try {
    accessSync(p, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function onPath(names: string[]): boolean {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map(e => e.toLowerCase()).concat('')
    : ['']
  for (const dir of searchDirs()) {
    for (const n of names) {
      for (const e of exts) {
        if (isExec(join(dir, n + e))) return true
      }
    }
  }
  return false
}

function anyExists(paths: (string | undefined)[]): boolean {
  return paths.some(p => !!p && isExec(p))
}

export function installSignals(id: ProviderId): boolean {
  const home = homedir()
  const pf = process.env.ProgramFiles
  const pf86 = process.env['ProgramFiles(x86)']
  const lad = process.env.LOCALAPPDATA
  switch (id) {
    case 'claude':
      return onPath(['claude']) || anyExists([
        '/Applications/Claude.app', join(home, 'Applications', 'Claude.app'),
        lad && join(lad, 'Programs', 'claude', 'Claude.exe'),
      ])
    case 'codex': {
      const bin = process.env.CODEX_BIN
      if (bin && isAbsolute(bin) && isExec(bin)) return true
      return onPath(['codex']) || anyExists([
        lad && join(lad, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
        lad && join(lad, 'Programs', 'OpenAI', 'Codex', 'codex.exe'),
        lad && join(lad, 'Programs', 'codex', 'codex.exe'),
        pf && join(pf, 'OpenAI', 'Codex', 'bin', 'codex.exe'),
      ]) || existsSync(join(home, '.codex', 'sessions')) || existsSync(join(home, '.codex', 'auth.json'))
    }
    case 'cursor':
      return onPath(['cursor', 'cursor-agent']) || anyExists([
        '/Applications/Cursor.app', join(home, 'Applications', 'Cursor.app'),
        lad && join(lad, 'Programs', 'cursor', 'Cursor.exe'),
        pf && join(pf, 'Cursor', 'Cursor.exe'),
        pf86 && join(pf86, 'Cursor', 'Cursor.exe'),
        '/opt/Cursor/cursor', '/usr/share/cursor/cursor', '/usr/bin/cursor',
      ])
    case 'pi':
      return onPath(['pi'])
    case 'opencode':
      return onPath(['opencode'])
    case 'copilot': {
      // `gh` on PATH only means "GitHub user" — require Copilot-specific state
      // (IDE plugin config dir, standalone Copilot CLI dir, or gh-copilot extension).
      const appData = process.env.APPDATA
      return [
        join(home, '.config', 'github-copilot'),
        join(home, '.copilot'),
        lad && join(lad, 'github-copilot'),
        appData && join(appData, 'GitHub Copilot'),
        join(home, '.local', 'share', 'gh', 'extensions', 'gh-copilot'),
      ].some(p => !!p && existsSync(p))
    }
    case 'antigravity':
      return onPath(['antigravity']) || anyExists([
        '/Applications/Antigravity.app', join(home, 'Applications', 'Antigravity.app'),
        lad && join(lad, 'Programs', 'Antigravity', 'Antigravity.exe'),
      ])
    case 'gemini':
      return onPath(['gemini'])
    default:
      return false
  }
}
