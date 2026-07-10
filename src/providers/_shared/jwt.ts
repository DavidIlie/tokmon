export function decodeBase64UrlJson(segment: string): any | null {
  try {
    if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

export interface IdTokenIdentity {
  email?: string
  displayName?: string
  // Decoded JWT payload, exposed for provider-specific claims. Absent when the
  // token is missing, malformed, or its payload is not an object.
  payload?: any
}

export function identityFromIdToken(idToken: unknown): IdTokenIdentity {
  if (typeof idToken !== 'string') return {}
  const parts = idToken.split('.')
  if (parts.length !== 3) return {}
  const payload = decodeBase64UrlJson(parts[1])
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : undefined
  const displayName = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim()
    : typeof payload.given_name === 'string' && payload.given_name.trim()
      ? payload.given_name.trim()
      : undefined
  return { email, displayName, payload }
}
