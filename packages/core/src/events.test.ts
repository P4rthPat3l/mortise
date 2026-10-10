import { type DomainEvent, sessionId } from "@mortise/domain"
import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { createEventBus } from "./events.js"

const resync: DomainEvent = { type: "resync", reason: "reconnected" }
const activity: DomainEvent = { type: "session.activity", sessionId: sessionId("ses_1"), status: "running" }

describe("createEventBus", () => {
  it("AC-1: publish reaches only listeners of that event type", () => {
    const bus = createEventBus()
    const activityListener = vi.fn()
    const resyncListener = vi.fn()
    bus.subscribe("session.activity", activityListener)
    bus.subscribe("resync", resyncListener)

    bus.publish(activity)

    expect(activityListener).toHaveBeenCalledWith(activity)
    expect(resyncListener).not.toHaveBeenCalled()
  })

  it("AC-1: the subscribe disposable removes the listener", () => {
    const bus = createEventBus()
    const listener = vi.fn()
    const subscription = bus.subscribe("resync", listener)

    subscription.dispose()
    bus.publish(resync)

    expect(listener).not.toHaveBeenCalled()
  })

  it("AC-1: a listener removed during notification is not called", () => {
    const bus = createEventBus()
    const first = vi.fn()
    const second = vi.fn()
    let secondSubscription: { dispose(): void } | undefined
    bus.subscribe("resync", () => {
      first()
      secondSubscription?.dispose()
    })
    secondSubscription = bus.subscribe("resync", second)

    bus.publish(resync)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it("AC-1: publishing a type with no listeners is a no-op", () => {
    const bus = createEventBus()
    expect(() => bus.publish(resync)).not.toThrow()
  })

  it("AC-1: a listener receives the event narrowed to its type", () => {
    const bus = createEventBus()
    bus.subscribe("resync", (event) => {
      expectTypeOf(event).toEqualTypeOf<Extract<DomainEvent, { type: "resync" }>>()
    })
    bus.subscribe("session.activity", (event) => {
      expectTypeOf(event).toEqualTypeOf<Extract<DomainEvent, { type: "session.activity" }>>()
    })
  })
})
