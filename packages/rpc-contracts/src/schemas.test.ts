import {
  type ConnectionState,
  type EngineCapabilities,
  type EngineInfo,
  type ResyncReason,
  type ServerRef,
  serverId,
} from "@mortise/domain"
import { describe, expect, expectTypeOf, it } from "vitest"
import type { z } from "zod"
import { events } from "./events.js"
import type {
  connectionStateSchema,
  engineCapabilitiesSchema,
  engineInfoSchema,
  resyncReasonSchema,
  serverRefSchema,
} from "./schemas.js"

// `toExtend` is asserted in both directions so each schema's inferred type and its domain type
// are mutually assignable: neither may be narrower or wider than the other.
describe("schemas mirror the domain model", () => {
  it("AC-1: ServerRef is mutually assignable with the domain type", () => {
    expectTypeOf<z.infer<typeof serverRefSchema>>().toExtend<ServerRef>()
    expectTypeOf<ServerRef>().toExtend<z.infer<typeof serverRefSchema>>()
  })

  it("AC-1: EngineCapabilities is mutually assignable with the domain type", () => {
    expectTypeOf<z.infer<typeof engineCapabilitiesSchema>>().toExtend<EngineCapabilities>()
    expectTypeOf<EngineCapabilities>().toExtend<z.infer<typeof engineCapabilitiesSchema>>()
  })

  it("AC-1: EngineInfo is mutually assignable with the domain type", () => {
    expectTypeOf<z.infer<typeof engineInfoSchema>>().toExtend<EngineInfo>()
    expectTypeOf<EngineInfo>().toExtend<z.infer<typeof engineInfoSchema>>()
  })

  it("AC-1: ConnectionState is mutually assignable with the domain type", () => {
    expectTypeOf<z.infer<typeof connectionStateSchema>>().toExtend<ConnectionState>()
    expectTypeOf<ConnectionState>().toExtend<z.infer<typeof connectionStateSchema>>()
  })

  it("AC-1: ResyncReason is mutually assignable with the domain type", () => {
    expectTypeOf<z.infer<typeof resyncReasonSchema>>().toExtend<ResyncReason>()
    expectTypeOf<ResyncReason>().toExtend<z.infer<typeof resyncReasonSchema>>()
  })

  it("AC-1: engine.events carries raw wire events as unknown[]", () => {
    const result = events["engine.events"].safeParse({
      serverId: serverId("s1"),
      generation: 1,
      events: [{ type: "session.updated" }],
    })
    expect(result.success).toBe(true)
  })
})
