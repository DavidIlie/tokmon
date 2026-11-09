import { parentPort } from 'node:worker_threads'
import { PROVIDERS } from '../providers'
import { flushDisk, invalidateSessionScans } from '../providers/usage-core'
import type { UsageWorkerRequest, UsageWorkerResponse } from './usage-runner'

// Everything that reads and aggregates session logs runs here. The owning
// thread is the daemon's event loop and, in the desktop app, Electron's main
// thread: a history pass over a long-lived machine is seconds of solid CPU,
// which there means a frozen menu bar.
const port = parentPort
if (port) {
  const reply = (message: UsageWorkerResponse) => port.postMessage(message)
  port.on('message', async (request: UsageWorkerRequest) => {
    try {
      let value: unknown = null
      if (request.kind === 'summary') {
        value = await PROVIDERS[request.account.providerId].fetchSummary?.(request.account, request.tz) ?? null
      } else if (request.kind === 'table') {
        value = await PROVIDERS[request.account.providerId].fetchTable?.(request.account, request.tz) ?? null
      } else if (request.kind === 'invalidate') {
        invalidateSessionScans()
      } else {
        await flushDisk()
      }
      reply({ id: request.id, ok: true, value })
    } catch (error) {
      reply({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
  reply({ ready: true })
}
