import { spawn, type ChildProcess } from 'node:child_process'
import { extname } from 'node:path'

const HANDSHAKE_TIMEOUT_MS = 3000

export type DaemonKind = 'spawned' | 'degraded'

export interface DaemonHandle {
  kind: DaemonKind
  baseUrl: string | null
  wsToken: string | null
  stop(): void
}

export interface AttachOrSpawnOptions {
  entry?: string
  execPath?: string
  execArgv?: string[]
  timeoutMs?: number
}

// In dev (tsx), forward tsx's loader flags from process.execArgv so the child runtime matches the parent.
function runtimeExecArgv(entry: string, override?: string[]): string[] {
  if (override) return override
  const ext = extname(entry).toLowerCase()
  if (ext !== '.ts' && ext !== '.tsx' && ext !== '.mts' && ext !== '.cts') return []
  const keepFlags = ['--require', '--import', '--loader']
  const out: string[] = []
  const src = process.execArgv
  for (let i = 0; i < src.length; i++) {
    const a = src[i]
    if (a.startsWith('--experimental-')) { out.push(a); continue }
    const matched = keepFlags.find(f => a === f || a.startsWith(f + '='))
    if (!matched) continue
    out.push(a)
    if (a === matched && i + 1 < src.length) out.push(src[++i])
  }
  return out
}

interface Handshake { ready: 1; url: string; port: number; wsToken: string; version: string }

function parseHandshake(line: string): Handshake | null {
  try {
    const o = JSON.parse(line) as Partial<Handshake>
    if (o && o.ready === 1 && typeof o.url === 'string' && typeof o.wsToken === 'string') return o as Handshake
    return null
  } catch {
    return null
  }
}

export function attachOrSpawn(opts: AttachOrSpawnOptions = {}): Promise<DaemonHandle> {
  const entry = opts.entry ?? process.argv[1]
  const execPath = opts.execPath ?? process.execPath
  const timeoutMs = opts.timeoutMs ?? HANDSHAKE_TIMEOUT_MS

  if (!entry) return Promise.resolve(degraded())

  return new Promise<DaemonHandle>((resolve) => {
    const args = ['__daemon', '--port', '0', '--no-open']
    const execArgv = runtimeExecArgv(entry, opts.execArgv)

    let child: ChildProcess
    try {
      child = spawn(execPath, [...execArgv, entry, ...args], {
        stdio: ['pipe', 'pipe', 'ignore'],
        detached: false,
      })
    } catch {
      resolve(degraded())
      return
    }

    let settled = false
    let stdoutBuf = ''
    let stopped = false

    const onExit = () => { try { if (!stopped) child.kill('SIGTERM') } catch {} }
    const onSignal = () => { onExit() }
    process.once('exit', onExit)
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)

    const removeHooks = () => {
      process.removeListener('exit', onExit)
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
    }

    const stop = () => {
      if (stopped) return
      stopped = true
      removeHooks()
      try { child.kill('SIGTERM') } catch {}
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGTERM') } catch {}
      removeHooks()
      resolve(degraded())
    }, timeoutMs)
    timer.unref?.()

    const finishSpawned = (url: string, wsToken: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.resume()
      resolve({ kind: 'spawned', baseUrl: url, wsToken, stop })
    }

    const finishDegraded = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill('SIGTERM') } catch {}
      removeHooks()
      resolve(degraded())
    }

    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      if (settled) return
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (!line) continue
        const hs = parseHandshake(line)
        if (hs) { finishSpawned(hs.url, hs.wsToken); return }
        finishDegraded()
        return
      }
    })

    child.once('error', finishDegraded)
    child.once('exit', () => { if (!settled) finishDegraded() })
  })
}

function degraded(): DaemonHandle {
  return { kind: 'degraded', baseUrl: null, wsToken: null, stop: () => {} }
}
