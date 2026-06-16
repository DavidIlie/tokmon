// Returns null if non-JSON content-type or parse fails, to avoid captive portals/proxies returning HTML as 200.
export async function readJson<T = unknown>(res: Response): Promise<T | null> {
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (type && !type.includes('json')) return null
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}
