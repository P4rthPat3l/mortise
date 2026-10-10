import { describe, expect, it, vi } from "vitest"
import { Registries, Registry } from "./registry.js"

const numbers = Registry.define<number>("numbers")

describe("Registries", () => {
  it("AC-1: add and list, keeping list results stable until a change", () => {
    const registries = new Registries()
    const empty = registries.list(numbers)
    expect(empty).toEqual([])
    expect(registries.list(numbers)).toBe(empty)

    const remove = registries.add(numbers, 1)
    const withOne = registries.list(numbers)
    expect(withOne).toEqual([1])
    expect(registries.list(numbers)).toBe(withOne)

    registries.add(numbers, 2)
    expect(registries.list(numbers)).toEqual([1, 2])
    expect(registries.list(numbers)).not.toBe(withOne)

    remove.dispose()
    expect(registries.list(numbers)).toEqual([2])
  })

  it("AC-1: tokens keep separate lists", () => {
    const registries = new Registries()
    const letters = Registry.define<string>("letters")
    registries.add(numbers, 1)
    registries.add(letters, "a")
    expect(registries.list(numbers)).toEqual([1])
    expect(registries.list(letters)).toEqual(["a"])
  })

  it("AC-1: subscribe is notified with the new list and can unsubscribe", () => {
    const registries = new Registries()
    const listener = vi.fn()
    const subscription = registries.subscribe(numbers, listener)

    registries.add(numbers, 1)
    expect(listener).toHaveBeenLastCalledWith([1])

    subscription.dispose()
    registries.add(numbers, 2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("AC-1: a listener removed during notification is not called", () => {
    const registries = new Registries()
    const first = vi.fn()
    const second = vi.fn()
    let secondSubscription: { dispose(): void } | undefined
    registries.subscribe(numbers, () => {
      first()
      secondSubscription?.dispose()
    })
    secondSubscription = registries.subscribe(numbers, second)

    registries.add(numbers, 1)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })
})
