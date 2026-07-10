export interface RefreshQueue {
  run(force?: boolean): Promise<void>
  stop(): void
}

type Deferred = {
  promise: Promise<void>
  resolve: () => void
  reject: (cause: unknown) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

// Automatic polls join current work. Forced calls coalesce into one subsequent
// pass, and every waiter follows later queued passes before it settles.
export function createRefreshQueue(
  perform: () => Promise<void>,
  skipAutomatic: () => boolean = () => false,
): RefreshQueue {
  let activePass: Promise<void> | null = null
  let activeResult: Deferred | null = null
  let queued: Deferred | null = null
  let stopped = false

  const launch = (result = deferred()): Promise<void> => {
    const pass = Promise.resolve().then(perform)
    activePass = pass
    activeResult = result
    const settled = (succeeded: boolean, cause?: unknown) => {
      if (activePass !== pass) return
      activePass = null
      activeResult = null
      const next = queued
      queued = null
      if (next && !stopped) {
        void next.promise.then(
          () => { if (succeeded) result.resolve(); else result.reject(cause) },
          result.reject,
        )
        launch(next)
        return
      }
      if (next) next.resolve()
      if (succeeded) result.resolve()
      else result.reject(cause)
    }
    void pass.then(() => settled(true), cause => settled(false, cause))
    return result.promise
  }

  const run = (force = false): Promise<void> => {
    if (stopped || (!force && skipAutomatic())) return Promise.resolve()
    if (!activePass) return launch()
    if (!force) return activeResult!.promise
    if (!queued) queued = deferred()
    return queued.promise
  }

  return {
    run,
    stop() {
      stopped = true
      activeResult?.resolve()
      queued?.resolve()
      queued = null
    },
  }
}

export async function settleRefreshTasks(tasks: readonly Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(tasks)
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
}
