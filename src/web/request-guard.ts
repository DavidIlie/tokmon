import { isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function hostnameFromHost(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(`http://${value.trim()}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return null
  }
}

export function isLoopbackHostHeader(value: string | undefined): boolean {
  const hostname = hostnameFromHost(value)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function isAllowedHostHeader(
  value: string | undefined,
  allowNetworkAccess: boolean,
  allowedHosts: readonly string[] = [],
): boolean {
  if (isLoopbackHostHeader(value)) return true
  if (!allowNetworkAccess) return false
  const hostname = hostnameFromHost(value)
  return hostname !== null && (isIP(hostname) !== 0 || allowedHosts.includes(hostname))
}

export function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = header(req, 'origin')
  if (!origin || origin === 'null') return true
  const host = header(req, 'host')?.trim().toLowerCase()
  if (!host) return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.host.toLowerCase() === host
  } catch {
    return false
  }
}

export function isAllowedLocalRequest(
  req: IncomingMessage,
  allowNetworkAccess: boolean,
  allowedHosts: readonly string[] = [],
): boolean {
  return isAllowedHostHeader(header(req, 'host'), allowNetworkAccess, allowedHosts) && isSameOriginRequest(req)
}
