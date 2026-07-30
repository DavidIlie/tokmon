import type { Server } from 'node:http'
import type test from 'node:test'

interface ListenResult<T> {
  value: T
}

export function listenOrSkip(t: test.TestContext, server: Server): Promise<ListenResult<void> | null>
export function listenOrSkip<T>(t: test.TestContext, listen: () => Promise<T>): Promise<ListenResult<T> | null>
export async function listenOrSkip<T>(
  t: test.TestContext,
  target: Server | (() => Promise<T>),
): Promise<ListenResult<T | void> | null> {
  try {
    const value = typeof target === 'function'
      ? await target()
      : await new Promise<void>((resolve, reject) => {
          target.once('error', reject)
          target.listen(0, '127.0.0.1', resolve)
        })
    return { value }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('the sandbox disallows binding ephemeral loopback ports')
      return null
    }
    throw cause
  }
}
