import { readFile, stat } from 'node:fs/promises'
import { expandHome } from '../config'
import type { QuotaSourceConfig } from '../config-schema'
import { requestPinned, resolveQuotaAddresses } from './_shared/quota-source'
import type { Account, BillingResult, Metric } from './types'

const snapshotFlights = new Map<string, { until: number; promise: Promise<unknown[]> }>()

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function serverUrl(source: QuotaSourceConfig): URL {
  const url = new URL(source.url)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('CLIProxy requires HTTPS, or HTTP on localhost')
  if (url.username || url.password || url.search || url.hash) throw new Error('Use a server URL without credentials, query, or fragment')
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/usage/limits`
  return url
}

const windowLabels: Record<string, string> = {
  five_hour: 'Session (5h)', seven_day: 'Weekly (7d)', seven_day_opus: 'Opus (7d)',
  seven_day_sonnet: 'Sonnet (7d)', seven_day_fable: 'Fable (7d)',
  primary: 'Session (5h)', secondary: 'Weekly (7d)',
}

export function cliProxyMetrics(windows: unknown[]): Metric[] {
  const metrics: Metric[] = []
  for (const value of windows) {
    const window = record(value)
    const name = typeof window.name === 'string' ? window.name : ''
    const used = typeof window.used_percent === 'number' ? window.used_percent
      : typeof window.remaining_percent === 'number' ? 100 - window.remaining_percent : null
    if (!name || used === null || !Number.isFinite(used)) continue
    const resetMs = typeof window.resets_at === 'string' ? Date.parse(window.resets_at) : NaN
    const resetsAt = Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null
    if (resetsAt && resetMs <= Date.now()) continue
    const session = name === 'five_hour' || name === 'primary'
    const weekly = name === 'seven_day' || name === 'secondary'
    metrics.push({
      key: name, label: windowLabels[name] ?? name.replaceAll('_', ' '),
      used: Math.max(0, Math.min(100, used)), limit: 100, format: { kind: 'percent' },
      role: session ? 'session' : weekly ? 'weekly' : 'model', primary: session, resetsAt,
    })
  }
  return metrics
}

export async function cliProxyBilling(account: Account): Promise<BillingResult> {
  try {
    const source = account.quotaSource
    if (!source?.keyFile || !source.credentialId) throw new Error('CLIProxy account ID and key file are required')
    const url = serverUrl(source)
    const keyPath = expandHome(source.keyFile)
    const info = await stat(keyPath)
    if (!info.isFile() || info.size > 16_384) throw new Error('API key file must be a small text file')
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('API key file must be private (chmod 600)')
    const key = (await readFile(keyPath, 'utf8')).trim()
    if (!key || /\s/.test(key)) throw new Error('API key file must contain one key')
    const cacheKey = `${url.href}:${keyPath}:${info.mtimeMs}`
    let flight = snapshotFlights.get(cacheKey)
    if (!flight || flight.until <= Date.now()) {
      const promise = (async () => {
        const response = await requestPinned(url, { Authorization: `Bearer ${key}`, Accept: 'application/json' }, await resolveQuotaAddresses(url, undefined, true))
        if (!response.ok) throw new Error(`CLIProxy returned HTTP ${response.status}`)
        const rows = record(await response.json()).data
        if (!Array.isArray(rows)) throw new Error('CLIProxy quota response is invalid')
        return rows
      })()
      flight = { until: Date.now() + 15_000, promise }
      snapshotFlights.set(cacheKey, flight)
      if (snapshotFlights.size > 16) snapshotFlights.delete(snapshotFlights.keys().next().value!)
    }
    const snapshot = record((await flight.promise).find(value => {
      const row = record(value)
      return row.auth_id === source.credentialId || row.auth_index === source.credentialId
    }))
    if (!snapshot.auth_id) throw new Error('Account is unavailable or not visible to this API key')
    if (snapshot.provider !== account.providerId) throw new Error('CLIProxy account provider does not match')
    const observedAt = typeof snapshot.observed_at === 'string' ? Date.parse(snapshot.observed_at) : NaN
    if (!Number.isFinite(observedAt)) throw new Error('CLIProxy quota observation time is missing')
    const metrics = cliProxyMetrics(Array.isArray(snapshot.windows) ? snapshot.windows : [])
    return {
      plan: 'CLIProxy', metrics,
      error: metrics.length ? null : 'Awaiting fresh quota observations from CLIProxy',
      displayName: account.name, asOfMs: observedAt,
    }
  } catch (error) {
    return { plan: null, metrics: [], error: error instanceof Error ? error.message : 'CLIProxy quota could not be read' }
  }
}
