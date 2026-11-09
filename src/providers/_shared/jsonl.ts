import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

export function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value
}

export async function* readJsonLines<T = any>(
  path: string,
  predicate?: (line: string) => boolean,
  options?: { ignoreReadErrors?: boolean; start?: number; end?: number },
): AsyncGenerator<T> {
  // `end` is exclusive here; createReadStream's is inclusive.
  if (options?.end !== undefined && options.end <= (options.start ?? 0)) return
  const input = createReadStream(path, {
    ...(options?.start !== undefined ? { start: options.start } : {}),
    ...(options?.end !== undefined ? { end: options.end - 1 } : {}),
  })
  input.on('error', () => {})
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const rawLine of rl) {
      if (predicate && !predicate(rawLine)) continue
      try {
        yield JSON.parse(stripBom(rawLine)) as T
      } catch {}
    }
  } catch (error) {
    if (options?.ignoreReadErrors === false) throw error
  } finally {
    rl.close()
    input.destroy()
  }
}
