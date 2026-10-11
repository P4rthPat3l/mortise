import { type Store as CoreStore, Registries, Registry } from "@mortise/core"
import { describe, expect, test } from "vitest"
import { Contract } from "./contract.js"
import { createModuleHost, type ModuleHost } from "./host.js"
import { Module, type Setup, Store } from "./module.js"

const Greeting = Contract.define<{ readonly message: string }>("greeting")
const Optional = Contract.define<number>("optional")
const items = Registry.define<string>("tests.items")

function makeHost(): ModuleHost {
  return createModuleHost({ core: { registries: new Registries() } })
}

describe("activation", () => {
  test("BR-002 a provider activates before a module that requires it", () => {
    const log: string[] = []
    const host = makeHost()
    const consumer = Module.define({ id: "consumer", requires: { greeting: Greeting } })
    const consumerSetup: Setup<typeof consumer> = (ctx) => {
      log.push(`consumer:${ctx.requires.greeting.message}`)
    }
    const greeter = Module.define({ id: "greeter", provides: { greeting: Greeting } })
    const greeterSetup: Setup<typeof greeter> = (ctx) => {
      log.push("greeter")
      ctx.provide(Greeting, { message: "hello" })
    }

    // The consumer registers first; the host still activates the provider before it.
    host.register(consumer, consumerSetup)
    host.register(greeter, greeterSetup)

    expect(log).toEqual(["greeter", "consumer:hello"])
    expect(host.module(consumer).status).toBe("active")
    expect(host.module(greeter).status).toBe("active")
  })

  test("BR-003 a blocked module resumes when its provider registers", () => {
    const host = makeHost()
    const consumer = Module.define({ id: "consumer", requires: { greeting: Greeting } })
    const consumerSetup: Setup<typeof consumer> = () => {}
    const greeter = Module.define({ id: "greeter", provides: { greeting: Greeting } })
    const greeterSetup: Setup<typeof greeter> = (ctx) => {
      ctx.provide(Greeting, { message: "hello" })
    }

    host.register(consumer, consumerSetup)
    expect(host.module(consumer)).toEqual({ status: "inactive", reason: "blocked" })

    host.register(greeter, greeterSetup)
    expect(host.module(consumer).status).toBe("active")
  })

  test("BR-009 the host orders by declaration, not registration order", () => {
    const host = makeHost()
    const greeter = Module.define({ id: "greeter", provides: { greeting: Greeting } })
    const greeterSetup: Setup<typeof greeter> = (ctx) => {
      ctx.provide(Greeting, { message: "hello" })
    }
    const consumer = Module.define({ id: "consumer", requires: { greeting: Greeting } })
    const consumerSetup: Setup<typeof consumer> = () => {}

    host.register(greeter, greeterSetup)
    host.register(consumer, consumerSetup)

    expect(host.module(consumer).status).toBe("active")
  })
})

describe("optional dependencies", () => {
  test("BR-004 a missing optional provider never blocks and reads as inactive", () => {
    const host = makeHost()
    const consumer = Module.define({ id: "consumer", uses: { optional: Optional } })
    let observed: unknown
    const consumerSetup: Setup<typeof consumer> = (ctx) => {
      observed = ctx.uses.optional
    }

    host.register(consumer, consumerSetup)

    expect(host.module(consumer).status).toBe("active")
    expect(observed).toEqual({ status: "inactive", reason: "disabled" })
  })

  test("CASE-005 an optional provider that arrives earlier is active on activation", () => {
    const host = makeHost()
    const provider = Module.define({ id: "provider", provides: { optional: Optional } })
    const providerSetup: Setup<typeof provider> = (ctx) => {
      ctx.provide(Optional, 42)
    }
    const consumer = Module.define({ id: "consumer", uses: { optional: Optional } })
    let observed: unknown
    const consumerSetup: Setup<typeof consumer> = (ctx) => {
      observed = ctx.uses.optional
    }

    host.register(provider, providerSetup)
    host.register(consumer, consumerSetup)

    expect(observed).toEqual({ status: "active", value: 42, generation: 1 })
  })
})

describe("failure isolation", () => {
  test("BR-005 a setup that throws fails only that module", () => {
    const host = makeHost()
    const bad = Module.define({ id: "bad" })
    const badSetup: Setup<typeof bad> = () => {
      throw new Error("boom")
    }
    const good = Module.define({ id: "good" })
    let goodRan = false
    const goodSetup: Setup<typeof good> = () => {
      goodRan = true
    }

    host.register(bad, badSetup)
    host.register(good, goodSetup)

    expect(host.module(bad)).toEqual({ status: "inactive", reason: "failed" })
    expect(host.module(good).status).toBe("active")
    expect(goodRan).toBe(true)
  })

  test("CASE-002 a setup that returns a thenable is failed, not awaited", () => {
    const host = makeHost()
    const asyncish = Module.define({ id: "asyncish" })
    const asyncSetup: Setup<typeof asyncish> = () => Promise.resolve()

    host.register(asyncish, asyncSetup)

    expect(host.module(asyncish)).toEqual({ status: "inactive", reason: "failed" })
  })

  test("CASE-004 a requires cycle leaves every member blocked", () => {
    const A = Contract.define<string>("a")
    const B = Contract.define<string>("b")
    const host = makeHost()
    const first = Module.define({ id: "first", provides: { a: A }, requires: { b: B } })
    const second = Module.define({ id: "second", provides: { b: B }, requires: { a: A } })
    const firstSetup: Setup<typeof first> = (ctx) => {
      ctx.provide(A, "a")
    }
    const secondSetup: Setup<typeof second> = (ctx) => {
      ctx.provide(B, "b")
    }

    host.register(first, firstSetup)
    host.register(second, secondSetup)

    expect(host.module(first)).toEqual({ status: "inactive", reason: "blocked" })
    expect(host.module(second)).toEqual({ status: "inactive", reason: "blocked" })
  })
})

describe("withdrawal", () => {
  test("BR-006 disabling a provider withdraws its contributions and blocks consumers", () => {
    const registries = new Registries()
    const host = createModuleHost({ core: { registries } })
    const greeter = Module.define({ id: "greeter", provides: { greeting: Greeting } })
    const greeterSetup: Setup<typeof greeter> = (ctx) => {
      ctx.provide(Greeting, { message: "hello" })
      ctx.add(items, "greeter")
    }
    const consumer = Module.define({ id: "consumer", requires: { greeting: Greeting } })
    const consumerSetup: Setup<typeof consumer> = () => {}

    host.register(greeter, greeterSetup)
    host.register(consumer, consumerSetup)
    expect(registries.list(items)).toEqual(["greeter"])
    expect(host.module(consumer).status).toBe("active")

    host.setEnabled(greeter, false)
    expect(host.module(greeter)).toEqual({ status: "inactive", reason: "disabled" })
    expect(registries.list(items)).toEqual([])
    expect(host.module(consumer)).toEqual({ status: "inactive", reason: "blocked" })

    host.setEnabled(greeter, true)
    expect(registries.list(items)).toEqual(["greeter"])
    expect(host.module(consumer).status).toBe("active")
  })

  test("CASE-003 unregistering an active module disposes its scope", () => {
    const registries = new Registries()
    const host = createModuleHost({ core: { registries } })
    const greeter = Module.define({ id: "greeter" })
    const greeterSetup: Setup<typeof greeter> = (ctx) => {
      ctx.add(items, "greeter")
    }

    const unregister = host.register(greeter, greeterSetup)
    expect(registries.list(items)).toEqual(["greeter"])

    unregister.dispose()
    expect(registries.list(items)).toEqual([])
    expect(host.module(greeter)).toEqual({ status: "inactive", reason: "disabled" })
  })
})

describe("contract liveness", () => {
  test("BR-008/BR-010 get() moves disabled, active, disabled, active with a higher generation", () => {
    const host = makeHost()
    const greeter = Module.define({ id: "greeter", provides: { greeting: Greeting } })
    const greeterSetup: Setup<typeof greeter> = (ctx) => {
      ctx.provide(Greeting, { message: "hello" })
    }

    expect(host.get(Greeting)).toEqual({ status: "inactive", reason: "disabled" })

    host.register(greeter, greeterSetup)
    const first = host.get(Greeting)
    expect(first).toEqual({ status: "active", value: { message: "hello" }, generation: 1 })

    host.setEnabled(greeter, false)
    expect(host.get(Greeting)).toEqual({ status: "inactive", reason: "disabled" })

    host.setEnabled(greeter, true)
    const second = host.get(Greeting)
    if (first.status === "active" && second.status === "active") {
      expect(second.generation).toBeGreaterThan(first.generation)
    } else {
      throw new Error("expected the contract to be active")
    }
  })

  test("BR-010 a declared but unprovided contract is pending", () => {
    const host = makeHost()
    const lazy = Module.define({ id: "lazy", provides: { greeting: Greeting } })
    // Declares the contract but never provides a value, so the contract stays pending.
    const lazySetup: Setup<typeof lazy> = () => {}

    host.register(lazy, lazySetup)

    expect(host.get(Greeting)).toEqual({ status: "pending" })
  })
})

describe("providers", () => {
  test("BR-007 two modules may not provide the same contract", () => {
    const host = makeHost()
    const first = Module.define({ id: "first", provides: { greeting: Greeting } })
    const second = Module.define({ id: "second", provides: { other: Greeting } })
    const firstSetup: Setup<typeof first> = () => {}
    const secondSetup: Setup<typeof second> = () => {}

    host.register(first, firstSetup)
    expect(() => host.register(second, secondSetup)).toThrow(/already provided/)
  })

  test("CASE-001 a module may not be registered twice", () => {
    const host = makeHost()
    const module = Module.define({ id: "module" })
    const setup: Setup<typeof module> = () => {}

    host.register(module, setup)
    expect(() => host.register(module, setup)).toThrow(/already registered/)
  })
})

describe("declared stores", () => {
  test("the host creates a store per activation from the declaration", () => {
    const host = makeHost()
    const module = Module.define({ id: "module", stores: { count: Store.define(0) } })
    let store: CoreStore<number> | undefined
    const setup: Setup<typeof module> = (ctx) => {
      store = ctx.stores.count
    }

    host.register(module, setup)

    expect(store?.getSnapshot()).toBe(0)
    store?.update((count) => count + 1)
    expect(store?.getSnapshot()).toBe(1)
  })
})
