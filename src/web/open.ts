import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

export function openBrowser(url: string): void {
  const target = url
  if (process.env.TOKMON_OPENLOG) {
    try { appendFileSync(process.env.TOKMON_OPENLOG, target + '\n') } catch {}
    return
  }
  try {
    if (process.platform === 'darwin') {
      spawn('open', [target], { stdio: 'ignore', detached: true }).unref()
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', target], { stdio: 'ignore', detached: true }).unref()
    } else {
      spawn('xdg-open', [target], { stdio: 'ignore', detached: true }).unref()
    }
  } catch {}
}
