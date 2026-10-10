import { describe, expect, it, vi } from "vitest"
import { createStore } from "./store.js"

describe("createStore", () => {
  it("AC-1: getSnapshot returns the value and update notifies subscribers", () => {
    const store = createStore(0)
    const listener = vi.fn()
    store.subscribe(listener)

    expect(store.getSnapshot()).toBe(0)
    store.update((current) => current + 1)
    expect(store.getSnapshot()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("AC-1: update with an equal value does not notify", () => {
    const store = createStore({ count: 0 })
    const listener = vi.fn()
    const value = store.getSnapshot()
    store.subscribe(listener)

    store.update(() => value)

    expect(listener).not.toHaveBeenCalled()
  })

  it("AC-1: subscribe returns an unsubscribe that stops notifications", () => {
    const store = createStore(0)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.update(() => 1)
    expect(listener).not.toHaveBeenCalled()
  })

  it("AC-1: a listener removed during notification is not called", () => {
    const store = createStore(0)
    const second = vi.fn()
    let unsubscribeSecond: (() => void) | undefined
    store.subscribe(() => unsubscribeSecond?.())
    unsubscribeSecond = store.subscribe(second)

    store.update(() => 1)
    expect(second).not.toHaveBeenCalled()

    store.update(() => 2)
    expect(second).not.toHaveBeenCalled()
  })

  it("AC-1: batch notifies once, including nested batches", () => {
    const store = createStore(0)
    const listener = vi.fn()
    store.subscribe(listener)

    store.batch(() => {
      store.update(() => 1)
      store.batch(() => store.update(() => 2))
    })

    expect(store.getSnapshot()).toBe(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("AC-1: batch with no change does not notify", () => {
    const store = createStore(0)
    const listener = vi.fn()
    store.subscribe(listener)

    store.batch(() => {})

    expect(listener).not.toHaveBeenCalled()
  })

  it("AC-2: select notifies only when the selected value changes", () => {
    const store = createStore({ count: 0, other: 0 })
    const view = store.select((state) => state.count)
    const listener = vi.fn()
    view.subscribe(listener)

    store.update((state) => ({ ...state, other: 1 }))
    expect(listener).not.toHaveBeenCalled()

    store.update((state) => ({ ...state, count: 1 }))
    expect(listener).toHaveBeenCalledTimes(1)

    store.update((state) => ({ ...state, count: 1 }))
    expect(listener).toHaveBeenCalledTimes(1)

    expect(view.getSnapshot()).toBe(1)
  })

  it("AC-2: select keeps a stable snapshot for an equal selection", () => {
    const store = createStore({ count: 0 })
    const view = store.select(
      (state) => ({ count: state.count }),
      (left, right) => left.count === right.count,
    )

    const first = view.getSnapshot()
    expect(view.getSnapshot()).toBe(first)

    store.update((state) => ({ count: state.count + 1 }))
    expect(view.getSnapshot()).not.toBe(first)
    expect(view.getSnapshot()).toEqual({ count: 1 })
  })
})
