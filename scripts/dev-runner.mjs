#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODES = new Set(['dev', 'dev:web', 'dev:desktop', 'dev:installed'])

export function createDevEnvironment(baseEnv = process.env) {
  return {
    ...baseEnv,
    TOKMON_CHANNEL: 'dev',
  }
}

export function installedDesktopExecutable(platform = process.platform, env = process.env) {
  const override = env.TOKMON_DESKTOP_APP_PATH?.trim()
  if (override) return override
  if (platform === 'darwin') return '/Applications/Tokmon.app/Contents/MacOS/Tokmon'
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local')
    return join(local, 'Programs', 'Tokmon', 'Tokmon.exe')
  }
  return join(homedir(), '.local', 'bin', 'tokmon-desktop')
}

export function commandForMode(mode, platform = process.platform, env = process.env) {
  const pnpm = platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  if (mode === 'dev') return { command: pnpm, args: ['exec', 'tsx', 'src/cli.tsx'] }
  if (mode === 'dev:web') return { command: pnpm, args: ['--prefix', 'web', 'run', 'dev'] }
  if (mode === 'dev:desktop') return { command: pnpm, args: ['--filter', '@tokmon/desktop', 'run', 'dev'] }
  if (mode === 'dev:installed') return { command: installedDesktopExecutable(platform, env), args: [] }
  throw new Error(`Unknown Tokmon development mode: ${mode}`)
}

export async function runDevMode(mode, options = {}) {
  if (!MODES.has(mode)) throw new Error(`Expected one of: ${[...MODES].join(', ')}`)
  const baseEnv = options.env ?? process.env
  const env = createDevEnvironment(baseEnv)
  const { command, args } = commandForMode(mode, options.platform ?? process.platform, env)
  if (mode === 'dev:installed' && !existsSync(command)) {
    throw new Error(`Tokmon Desktop is not installed at ${command}. Set TOKMON_DESKTOP_APP_PATH to override.`)
  }
  process.stderr.write(`[tokmon dev] mode=${mode} channel=dev command=${command}\n`)
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: 'inherit',
    shell: false,
  })
  const forward = signal => {
    if (!child.killed) child.kill(signal)
  }
  process.once('SIGINT', forward)
  process.once('SIGTERM', forward)
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    })
  } finally {
    process.off('SIGINT', forward)
    process.off('SIGTERM', forward)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2] ?? 'dev'
  runDevMode(mode).then(code => { process.exitCode = code }).catch(error => {
    process.stderr.write(`tokmon dev: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
