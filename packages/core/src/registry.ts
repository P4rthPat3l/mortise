import { createDisposable, type Disposable } from "./disposable.js"

const registryItem: unique symbol = Symbol("mortise.registry.item")

/**
 * A typed registry token. Items of type `T` are contributed to a {@link Registries} container under
 * it. `Registry.define` creates one; the host never knows which module defined it.
 */
export interface Registry<T> {
  /** Stable identifier, used in diagnostics. */
  readonly id: string
  /** Phantom type parameter: the type of the items this token accepts. */
  readonly [registryItem]?: T
}

/** Creates registry tokens. */
export const Registry = {
  /** Creates a token for items of type `T` with a stable id. */
  define<T>(id: string): Registry<T> {
    return { id }
  },
}

interface Entry {
  items: readonly unknown[]
  readonly listeners: Array<(items: readonly unknown[]) => void>
}

/** A contribution container: one insertion-ordered list per {@link Registry} token. */
export class Registries {
  private readonly entries = new Map<object, Entry>()

  /** Adds an item. Returns a disposable that removes it. */
  add<T>(token: Registry<T>, item: T): Disposable {
    const entry = this.entryFor(token)
    entry.items = [...entry.items, item]
    this.notify(entry)
    return createDisposable(() => {
      const index = entry.items.indexOf(item)
      if (index === -1) return
      const next = [...entry.items]
      next.splice(index, 1)
      entry.items = next
      this.notify(entry)
    })
  }

  /** The current items. The returned array is stable until the list changes. */
  list<T>(token: Registry<T>): readonly T[] {
    return this.entryFor(token).items as readonly T[]
  }

  /**
   * Calls the listener whenever the list changes. A listener removed while a notification runs is
   * not called. The returned disposable removes it.
   */
  subscribe<T>(token: Registry<T>, listener: (items: readonly T[]) => void): Disposable {
    const entry = this.entryFor(token)
    const wrapped = (items: readonly unknown[]) => listener(items as readonly T[])
    entry.listeners.push(wrapped)
    return createDisposable(() => {
      const index = entry.listeners.indexOf(wrapped)
      if (index !== -1) entry.listeners.splice(index, 1)
    })
  }

  private entryFor<T>(token: Registry<T>): Entry {
    let entry = this.entries.get(token)
    if (!entry) {
      entry = { items: [], listeners: [] }
      this.entries.set(token, entry)
    }
    return entry
  }

  private notify(entry: Entry): void {
    for (const listener of [...entry.listeners]) {
      if (entry.listeners.includes(listener)) listener(entry.items)
    }
  }
}
