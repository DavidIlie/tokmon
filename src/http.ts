export async function readJson<T = unknown>(res: Response): Promise<T | null> {
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (type && !type.includes('json')) return null
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}
