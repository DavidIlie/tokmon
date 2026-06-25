import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

export const IS_TTY = process.stdin.isTTY === true
export const REPO_URL = 'https://github.com/DavidIlie/tokmon'
export const SITE_URL = 'https://davidilie.com'
export const IS_APPLE_TERMINAL = process.env.TERM_PROGRAM === 'Apple_Terminal'

function detectHyperlinks(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  const force = env.FORCE_HYPERLINK
  if (force != null && force !== '') return force !== '0' && force.toLowerCase() !== 'false'
  if (!isTTY || env.TERM === 'dumb' || env.NO_HYPERLINK) return false
  if (env.WT_SESSION || env.ConEmuANSI === 'ON' || env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return true
  if (env.KONSOLE_VERSION || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') return true
  if (env.VTE_VERSION && Number(env.VTE_VERSION) >= 5000) return true
  const tp = env.TERM_PROGRAM
  if (tp) {
    const [maj, min] = (env.TERM_PROGRAM_VERSION ?? '').split('.').map(n => Number(n) || 0)
    if (tp === 'iTerm.app') return maj > 3 || (maj === 3 && min >= 1)
    if (tp === 'vscode' || tp === 'WezTerm' || tp === 'ghostty' || tp === 'Hyper' || tp === 'Tabby' || tp === 'rio') return true
  }
  return false
}

export const HYPERLINKS = detectHyperlinks(process.env, process.stdout.isTTY === true)

export function openUrl(url: string): void {
  if (process.env.TOKMON_OPENLOG) {
    try { appendFileSync(process.env.TOKMON_OPENLOG, url + '\n') } catch {}
    return
  }
  try {
    if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
  } catch {}
}

export function osc8(text: string, url: string): string {
  if (!HYPERLINKS) return text
  return `]8;;${url}${text}]8;;`
}
