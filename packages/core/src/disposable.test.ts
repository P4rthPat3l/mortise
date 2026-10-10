import { describe, expect, it, vi } from "vitest"
import { createDisposable, createDisposableScope } from "./disposable.js"

describe("createDisposable", () => {
  it("AC-1: runs the cleanup once and reports disposed", () => {
    const cleanup = vi.fn()
    const disposable = createDisposable(cleanup)
    expect(disposable.disposed).toBe(false)
    disposable.dispose()
    disposable.dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(disposable.disposed).toBe(true)
  })
})

describe("createDisposableScope", () => {
  it("AC-1: runs cleanups last-in-first-out", () => {
    const order: string[] = []
    const scope = createDisposableScope()
    scope.add(() => order.push("first"))
    scope.add(() => order.push("second"))
    scope.add(createDisposable(() => order.push("third")))
    scope.dispose()
    expect(order).toEqual(["third", "second", "first"])
  })

  it("AC-1: double dispose runs cleanups once", () => {
    const cleanup = vi.fn()
    const scope = createDisposableScope()
    scope.add(cleanup)
    scope.dispose()
    scope.dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(scope.disposed).toBe(true)
  })

  it("AC-1: aborts the signal on dispose, and not before", () => {
    const scope = createDisposableScope()
    expect(scope.signal.aborted).toBe(false)
    scope.dispose()
    expect(scope.signal.aborted).toBe(true)
  })

  it("AC-1: the disposable returned by add withdraws the cleanup", () => {
    const cleanup = vi.fn()
    const scope = createDisposableScope()
    const registration = scope.add(cleanup)
    registration.dispose()
    scope.dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(registration.disposed).toBe(true)
  })

  it("AC-1: a registration after disposal runs at once", () => {
    const cleanup = vi.fn()
    const scope = createDisposableScope()
    scope.dispose()
    const registration = scope.add(cleanup)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(registration.disposed).toBe(true)
  })

  it("AC-1: disposing the parent disposes child scopes", () => {
    const order: string[] = []
    const parent = createDisposableScope()
    const child = createDisposableScope(parent)
    parent.add(() => order.push("parent"))
    child.add(() => order.push("child"))
    expect(child.signal.aborted).toBe(false)
    parent.dispose()
    expect(child.disposed).toBe(true)
    expect(child.signal.aborted).toBe(true)
    // LIFO: the parent's own cleanup was registered after the child scope, so it runs first.
    expect(order).toEqual(["parent", "child"])
  })

  it("AC-1: a child of an already-disposed parent is disposed at once", () => {
    const parent = createDisposableScope()
    parent.dispose()
    const child = createDisposableScope(parent)
    expect(child.disposed).toBe(true)
    expect(child.signal.aborted).toBe(true)
  })
})
