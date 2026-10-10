/**
 * A read-only view compatible with React's `useSyncExternalStore`: `subscribe` returns an
 * unsubscribe function and `getSnapshot` returns a stable reference while the value is unchanged.
 */
export interface ReadableStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** A reactive container. `update` replaces the value; `batch` defers notification until it ends. */
export interface Store<T> extends ReadableStore<T> {
  update(update: (current: T) => T): void
  batch(fn: () => void): void
  /** A view that notifies only when the selected value changes, per `equals` (default `Object.is`). */
  select<U>(selector: (value: T) => U, equals?: (a: U, b: U) => boolean): ReadableStore<U>
}

/** Creates a store holding `initial`. */
export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  let batchDepth = 0
  let dirty = false

  const notify = (): void => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener()
    }
  }

  const store: Store<T> = {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(update) {
      const next = update(value)
      if (Object.is(next, value)) return
      value = next
      if (batchDepth > 0) {
        dirty = true
        return
      }
      notify()
    },
    batch(fn) {
      batchDepth += 1
      try {
        fn()
      } finally {
        batchDepth -= 1
        if (batchDepth === 0 && dirty) {
          dirty = false
          notify()
        }
      }
    },
    select(selector, equals = Object.is) {
      let selected = selector(value)
      return {
        getSnapshot: () => {
          const next = selector(value)
          if (equals(selected, next)) return selected
          selected = next
          return selected
        },
        subscribe(listener) {
          return store.subscribe(() => {
            const next = selector(value)
            if (equals(selected, next)) return
            selected = next
            listener()
          })
        },
      }
    },
  }

  return store
}
