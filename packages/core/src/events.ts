import type { DomainEvent } from "@mortise/domain"
import { createDisposable, type Disposable } from "./disposable.js"

/** The `type` discriminant of {@link DomainEvent}. */
export type DomainEventType = DomainEvent["type"]

/** A listener narrowed to one event type. */
export type DomainEventListener<T extends DomainEventType> = (event: Extract<DomainEvent, { type: T }>) => void

/** A typed, past-tense bus. An event reaches only listeners subscribed to its type. */
export interface EventBus {
  publish(event: DomainEvent): void
  subscribe<T extends DomainEventType>(type: T, listener: DomainEventListener<T>): Disposable
}

/** Creates an {@link EventBus}. */
export function createEventBus(): EventBus {
  const listeners = new Map<DomainEventType, Array<(event: DomainEvent) => void>>()

  function publish(event: DomainEvent): void {
    const entries = listeners.get(event.type)
    if (!entries) return
    for (const listener of [...entries]) {
      if (entries.includes(listener)) listener(event)
    }
  }

  function subscribe<T extends DomainEventType>(type: T, listener: DomainEventListener<T>): Disposable {
    const entries = listeners.get(type) ?? []
    listeners.set(type, entries)
    const wrapped = (event: DomainEvent) => listener(event as Extract<DomainEvent, { type: T }>)
    entries.push(wrapped)
    return createDisposable(() => {
      const index = entries.indexOf(wrapped)
      if (index !== -1) entries.splice(index, 1)
    })
  }

  return { publish, subscribe }
}
