import { describe, expect, test } from "vitest"
import { Contract } from "./contract.js"

describe("Contract", () => {
  test("define returns a token with its id", () => {
    const Greeting = Contract.define<{ message: string }>("greeting")

    expect(Greeting.id).toBe("greeting")
  })

  test("two tokens with the same id are distinct identities", () => {
    const first = Contract.define<string>("greeting")
    const second = Contract.define<string>("greeting")

    expect(first).not.toBe(second)
  })
})
