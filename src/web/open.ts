import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'

export function browserUrl(url: string, wsToken?: string): string {
  return wsToken ? `${url}#tokmonToken=${encodeURIComponent(wsToken)}` : url
}

export function openBrowser(url: string, wsToken?: string): void {
  const target = browserUrl(url, wsToken)
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
