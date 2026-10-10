import { serverId } from "@mortise/domain"
import { describe, expect, it } from "vitest"
import { engineFetchInputSchema } from "./methods.js"

const base = {
  serverId: serverId("s1"),
  method: "GET",
  path: "/api/session",
  body: null,
} as const

describe("engine.fetch input constraints", () => {
  it("AC-3: accepts an allowlisted path and an allowed header", () => {
    expect(engineFetchInputSchema.safeParse({ ...base, headers: { accept: "application/json" } }).success).toBe(true)
    expect(engineFetchInputSchema.safeParse({ ...base, path: "/openapi.json" }).success).toBe(true)
  })

  it("AC-3: rejects paths outside the allowlist", () => {
    for (const path of ["/auth/connect/x", "http://evil.example/api/x", "/apiary", "api/session", "/../api/x", ""]) {
      expect(engineFetchInputSchema.safeParse({ ...base, path }).success).toBe(false)
    }
  })

  it("AC-3: rejects a path containing ..", () => {
    expect(engineFetchInputSchema.safeParse({ ...base, path: "/api/../secret" }).success).toBe(false)
  })

  it("AC-3: rejects authorization, cookie and proxy-authorization case-insensitively", () => {
    for (const name of ["authorization", "Cookie", "Proxy-Authorization", "AUTHORIZATION", "prOxY-aUtHoRiZaTiOn"]) {
      expect(engineFetchInputSchema.safeParse({ ...base, headers: { [name]: "x" } }).success).toBe(false)
    }
  })

  it("AC-3: rejects an unsupported HTTP method", () => {
    expect(engineFetchInputSchema.safeParse({ ...base, method: "TRACE" }).success).toBe(false)
  })

  it("AC-3: accepts text and base64 bodies and rejects a malformed one", () => {
    expect(engineFetchInputSchema.safeParse({ ...base, body: { kind: "text", text: "hi" } }).success).toBe(true)
    expect(engineFetchInputSchema.safeParse({ ...base, body: { kind: "base64", data: "aGk=" } }).success).toBe(true)
    expect(engineFetchInputSchema.safeParse({ ...base, body: { kind: "json", value: {} } }).success).toBe(false)
  })

  it("AC-3: accepts a query of strings and string arrays", () => {
    expect(engineFetchInputSchema.safeParse({ ...base, query: { directory: "/tmp", id: ["a", "b"] } }).success).toBe(
      true,
    )
    expect(engineFetchInputSchema.safeParse({ ...base, query: { limit: 5 } }).success).toBe(false)
  })
})
