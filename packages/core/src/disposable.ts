/** A cleanup that runs at most once. */
export interface Disposable {
  /** True once {@link Disposable.dispose} has run. */
  readonly disposed: boolean
  /** Runs the cleanup. Calling it again does nothing. */
  dispose(): void
}

/** Wraps a cleanup function so it runs at most once. */
export function createDisposable(cleanup: () => void): Disposable {
  let disposed = false
  return {
    get disposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      cleanup()
    },
  }
}

/** A cleanup accepted by {@link DisposableScope.add}. */
export type Cleanup = Disposable | (() => void)

const DISPOSED: Disposable = {
  disposed: true,
  dispose() {},
}

/**
 * Owns a set of cleanups and an {@link AbortSignal}. Disposing it aborts the signal and runs every
 * cleanup last-in-first-out. A child scope is owned by its parent and disposed with it.
 */
export interface DisposableScope extends Disposable {
  /** Aborted when the scope is disposed. Async work checks it after every await. */
  readonly signal: AbortSignal
  /**
   * Registers a cleanup and returns a disposable that withdraws and runs it. A registration made
   * after the scope is disposed runs at once.
   */
  add(cleanup: Cleanup): Disposable
}

/** Creates a {@link DisposableScope}, optionally owned by a parent scope. */
export function createDisposableScope(parent?: DisposableScope): DisposableScope {
  const controller = new AbortController()
  const cleanups: Cleanup[] = []
  let disposed = false

  const scope: DisposableScope = {
    get disposed() {
      return disposed
    },
    get signal() {
      return controller.signal
    },
    add(cleanup) {
      if (disposed) {
        runCleanup(cleanup)
        return DISPOSED
      }
      cleanups.push(cleanup)
      return createDisposable(() => {
        const index = cleanups.indexOf(cleanup)
        if (index === -1) return
        cleanups.splice(index, 1)
        runCleanup(cleanup)
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop()) {
        runCleanup(cleanup)
      }
    },
  }

  // Registering with an already-disposed parent disposes this scope at once.
  parent?.add(scope)
  return scope
}

function runCleanup(cleanup: Cleanup): void {
  if (typeof cleanup === "function") cleanup()
  else cleanup.dispose()
}
