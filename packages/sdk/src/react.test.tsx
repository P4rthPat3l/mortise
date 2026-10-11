// @vitest-environment happy-dom

import { Registries } from "@mortise/core"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test } from "vitest"
import { Contract } from "./contract.js"
import { createModuleHost, type ModuleHost } from "./host.js"
import { Module, type Setup, Store } from "./module.js"
import { ModuleHostProvider, useLive, useModule, useStoreSelector } from "./react.js"

const Greeting = Contract.define<{ readonly message: string }>("greeting")

const greeter = Module.define({
  id: "greeter",
  provides: { greeting: Greeting },
  stores: { count: Store.define(0) },
})

const greeterSetup: Setup<typeof greeter> = (ctx) => {
  ctx.provide(Greeting, { message: "hello" })
}

function makeHost(): ModuleHost {
  return createModuleHost({ core: { registries: new Registries() } })
}

afterEach(cleanup)

function LiveView() {
  const live = useLive(Greeting)
  const label = live.status === "active" ? live.value.message : live.status
  return <span data-testid="live">{label}</span>
}

function StoreView() {
  const ctx = useModule(greeter)
  const count = useStoreSelector(ctx.stores.count, (value) => value)
  return (
    <button type="button" data-testid="count" onClick={() => ctx.stores.count.update((value) => value + 1)}>
      {count}
    </button>
  )
}

describe("react bindings", () => {
  test("useLive renders the contract's Live value and updates with the host", () => {
    const host = makeHost()
    render(
      <ModuleHostProvider host={host}>
        <LiveView />
      </ModuleHostProvider>,
    )

    expect(screen.getByTestId("live").textContent).toBe("inactive")

    act(() => {
      host.register(greeter, greeterSetup)
    })

    expect(screen.getByTestId("live").textContent).toBe("hello")
  })

  test("useModule returns the context and useStoreSelector re-renders on change", () => {
    const host = makeHost()
    host.register(greeter, greeterSetup)
    render(
      <ModuleHostProvider host={host}>
        <StoreView />
      </ModuleHostProvider>,
    )

    expect(screen.getByTestId("count").textContent).toBe("0")

    fireEvent.click(screen.getByTestId("count"))

    expect(screen.getByTestId("count").textContent).toBe("1")
  })

  test("BR-010 a hook without a provider throws", () => {
    function Bare() {
      useLive(Greeting)
      return null
    }

    expect(() => render(<Bare />)).toThrow(/ModuleHostProvider is missing/)
  })
})
