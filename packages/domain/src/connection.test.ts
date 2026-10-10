import { describe, expect, expectTypeOf, it } from "vitest"
import type { ConnectionPhase, ConnectionState } from "./connection.js"
import { messageId, partId, projectId, requestId, serverId, sessionId } from "./ids.js"
import { isTerminalToolState } from "./timeline.js"

describe("ConnectionState", () => {
  it("AC-4: phase is exactly the overview 6.6 states", () => {
    expectTypeOf<ConnectionPhase>().toEqualTypeOf<
      | "discovering"
      | "starting"
      | "no-engine"
      | "connecting"
      | "unauthorized"
      | "incompatible"
      | "hydrating"
      | "live"
      | "resyncing"
      | "failed"
    >()
  })

  it("AC-4: a switch over phase is exhaustive", () => {
    const label = (state: ConnectionState): string => {
      switch (state.phase) {
        case "discovering":
        case "starting":
        case "no-engine":
        case "connecting":
        case "unauthorized":
        case "incompatible":
        case "hydrating":
        case "live":
        case "resyncing":
        case "failed":
          return state.phase
        default:
          expectTypeOf(state).toBeNever()
          return "unreachable"
      }
    }
    expect(label({ phase: "no-engine" })).toBe("no-engine")
  })
})

describe("isTerminalToolState", () => {
  it("AC-5: success and failed are terminal", () => {
    expect(isTerminalToolState("success")).toBe(true)
    expect(isTerminalToolState("failed")).toBe(true)
  })

  it("AC-5: pending and running are not terminal", () => {
    expect(isTerminalToolState("pending")).toBe(false)
    expect(isTerminalToolState("running")).toBe(false)
  })
})

describe("id constructors", () => {
  it("AC-5: return the same string, branded", () => {
    expect(serverId("a")).toBe("a")
    expect(sessionId("ses_1")).toBe("ses_1")
    expect(messageId("m")).toBe("m")
    expect(partId("p")).toBe("p")
    expect(requestId("frm_1")).toBe("frm_1")
    expect(projectId("prj")).toBe("prj")
    expectTypeOf(sessionId("x")).not.toEqualTypeOf<string>()
  })
})
