import { describe, expect, it } from "vitest"
import { isExtensionRequest } from "./envelope.js"

const valid = {
  protocol: "mortise-extension-rpc",
  version: 1,
  direction: "extension-to-host",
  id: "ext-1",
  kind: "request",
  call: "notify",
  params: { kind: "info", message: "hello" },
}

describe("extension RPC envelope", () => {
  it("accepts a current-version extension-to-host request", () => {
    expect(isExtensionRequest(valid)).toBe(true)
  })

  it("rejects a version the host does not speak", () => {
    expect(isExtensionRequest({ ...valid, version: 2 })).toBe(false)
  })

  it("rejects a message that claims to travel host-to-extension", () => {
    expect(isExtensionRequest({ ...valid, direction: "host-to-extension" })).toBe(false)
  })

  it("rejects a call outside the three-call surface", () => {
    expect(isExtensionRequest({ ...valid, call: "sessions.read" })).toBe(false)
  })

  it("rejects a response, a missing id and non-object params", () => {
    expect(isExtensionRequest({ ...valid, kind: "response" })).toBe(false)
    expect(isExtensionRequest({ ...valid, id: "" })).toBe(false)
    expect(isExtensionRequest({ ...valid, params: [] })).toBe(false)
    expect(isExtensionRequest({ ...valid, params: null })).toBe(false)
  })
})
