import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

export function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value
}

export async function* readJsonLines<T = any>(
  path: string,
  predicate?: (line: string) => boolean,
  options?: { ignoreReadErrors?: boolean },
): AsyncGenerator<T> {
  const input = createReadStream(path)
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
