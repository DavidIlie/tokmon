import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

export function openBrowser(url: string): void {
  if (process.env.TOKMON_OPENLOG) {
    try { appendFileSync(process.env.TOKMON_OPENLOG, url + '\n') } catch {}
    return
  }
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
    }
  } catch {}
}
