import { describe, expect, test } from "vitest"
import { Contract } from "./contract.js"
import { Module, type Setup } from "./module.js"

const Greeting = Contract.define<{ message: string }>("greeting")
const Other = Contract.define<number>("other")

const definition = Module.define({ id: "consumer", provides: { greeting: Greeting } })

const setup: Setup<typeof definition> = (ctx) => {
  // @ts-expect-error "sessions" is not declared in uses
  void ctx.uses.sessions
  // @ts-expect-error "sessions" is not declared in requires
  void ctx.requires.sessions
  // @ts-expect-error "sessions" is not declared in stores
  void ctx.stores.sessions
  // @ts-expect-error "other" is not declared in provides
  void ctx.provide(Other, 1)
}

describe("Module", () => {
  test("BR-001 reading an undeclared dependency does not compile", () => {
    expect(definition.id).toBe("consumer")
    expect(setup).toBeTypeOf("function")
  })
})
