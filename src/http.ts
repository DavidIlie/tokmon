/**
 * Parse a fetch Response as JSON, but only when the server actually sent JSON.
 * Captive portals and proxies happily return an HTML error page with a 200,
 * which makes a bare `res.json()` read the whole irrelevant body just to throw.
 * Rejects an explicit non-JSON content-type up front; stays lenient when the
 * header is absent (some minimal APIs omit it).
 */
export async function readJson<T = unknown>(res: Response): Promise<T | null> {
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (type && !type.includes('json')) return null
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}
