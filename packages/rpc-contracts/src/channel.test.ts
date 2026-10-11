import { type ConnectionState, type ServerRef, serverId } from "@mortise/domain"
import { describe, expect, expectTypeOf, it } from "vitest"
import {
  type AbortSignalLike,
  ChannelError,
  createClient,
  createServer,
  type MethodHandlers,
  type RequestOptions,
  type Transport,
} from "./channel.js"
import type { EventPayload } from "./events.js"
import { createMemoryTransportPair } from "./memory.js"

const shared = serverId("s1")

const live: ConnectionState = {
  phase: "live",
  info: {
    version: "2.0.26",
    capabilities: {
      pairing: true,
      persistentTerminals: false,
      forkBeforeMessage: true,
      experimental: new Set(["experimental.ping"]),
    },
    support: "supported",
  },
}

const servers: ServerRef[] = [{ id: shared, label: "Shared service", kind: "shared", url: "http://127.0.0.1:4096" }]

const handlers: MethodHandlers = {
  "servers.list": () => servers,
  "connection.get": (input) => (input.serverId === shared ? live : { phase: "no-engine" }),
  "engine.fetch": () => ({
    status: 200,
    headers: { "content-type": "text/plain" },
    body: { kind: "text", text: "ok" },
  }),
}

function setup(registered: Partial<MethodHandlers>) {
  const transports = createMemoryTransportPair()
  const server = createServer(transports.server, registered)
  const client = createClient(transports.client)
  // Lets tests exercise the runtime validation paths that the typed signature rules out.
  const rawRequest = client.request as unknown as (
    name: string,
    input?: unknown,
    options?: RequestOptions,
  ) => Promise<unknown>
  return { client, server, rawRequest }
}

function fakeSignal(): { signal: AbortSignalLike; abort: () => void } {
  const listeners = new Set<() => void>()
  let aborted = false
  return {
    signal: {
      get aborted() {
        return aborted
      },
      addEventListener(_type, listener) {
        listeners.add(listener)
      },
      removeEventListener(_type, listener) {
        listeners.delete(listener)
      },
    },
    abort: () => {
      aborted = true
      for (const listener of [...listeners]) listener()
    },
  }
}

describe("channel round trips", () => {
  it("AC-1: servers.list infers ServerRef[] without a cast", async () => {
    const { client } = setup(handlers)
    const result = await client.request("servers.list", undefined)
    expectTypeOf(result).toExtend<ServerRef[]>()
    expectTypeOf<ServerRef[]>().toExtend<typeof result>()
    expect(result).toEqual(servers)
  })

  it("AC-1: connection.get round-trips a ConnectionState", async () => {
    const { client } = setup(handlers)
    const state = await client.request("connection.get", { serverId: shared })
    expectTypeOf(state).toExtend<ConnectionState>()
    expectTypeOf<ConnectionState>().toExtend<typeof state>()
    expect(state).toEqual(live)
  })

  it("AC-1: engine.fetch round-trips an inferred request and response", async () => {
    const { client } = setup(handlers)
    const response = await client.request("engine.fetch", {
      serverId: shared,
      method: "POST",
      path: "/api/session/ses_1/prompt",
      query: { directory: "/tmp" },
      headers: { accept: "application/json" },
      body: { kind: "text", text: "hello" },
    })
    expectTypeOf(response).toExtend<{
      status: number
      headers: Record<string, string>
      body: null | { kind: "text"; text: string } | { kind: "base64"; data: string }
    }>()
    expectTypeOf<{
      status: number
      headers: Record<string, string>
      body: null | { kind: "text"; text: string } | { kind: "base64"; data: string }
    }>().toExtend<typeof response>()
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ kind: "text", text: "ok" })
  })
})

describe("channel failures", () => {
  it("AC-2: an invalid input rejects with invalid_input", async () => {
    const { rawRequest } = setup(handlers)
    await expect(rawRequest("connection.get", {})).rejects.toMatchObject({ code: "invalid_input" })
    await expect(rawRequest("connection.get", { serverId: 42 })).rejects.toMatchObject({ code: "invalid_input" })
  })

  it("AC-2: a request for an unknown method is answered with method_not_found", () => {
    const transports = createMemoryTransportPair()
    createServer(transports.server, handlers)
    const responses: unknown[] = []
    transports.client.onMessage((message) => responses.push(message))
    transports.client.send({ v: 1, id: "req_1", type: "request", name: "does.not.exist", payload: {} })
    expect(responses).toEqual([
      {
        v: 1,
        id: "req_1",
        type: "response",
        name: "does.not.exist",
        error: { code: "method_not_found", message: expect.any(String) },
      },
    ])
  })

  it("AC-2: a method with no registered handler rejects with method_not_found", async () => {
    const { rawRequest } = setup({})
    await expect(rawRequest("servers.list", undefined)).rejects.toMatchObject({ code: "method_not_found" })
  })

  it("AC-2: a request that never answers rejects with timeout", async () => {
    const { rawRequest } = setup({ "servers.list": () => new Promise<never>(() => {}) })
    await expect(rawRequest("servers.list", undefined, { timeoutMs: 10 })).rejects.toMatchObject({ code: "timeout" })
  })

  it("AC-2: aborting an in-flight request rejects with aborted", async () => {
    const { rawRequest } = setup({ "servers.list": () => new Promise<never>(() => {}) })
    const { signal, abort } = fakeSignal()
    const promise = rawRequest("servers.list", undefined, { signal })
    abort()
    await expect(promise).rejects.toMatchObject({ code: "aborted" })
  })

  it("AC-2: an already-aborted signal rejects with aborted", async () => {
    const { rawRequest } = setup(handlers)
    const { signal, abort } = fakeSignal()
    abort()
    await expect(rawRequest("servers.list", undefined, { signal })).rejects.toMatchObject({ code: "aborted" })
  })

  it("AC-2: a handler output that violates its schema rejects with invalid_output", async () => {
    const { rawRequest } = setup({ "connection.get": () => ({ phase: "bogus" }) as never })
    await expect(rawRequest("connection.get", { serverId: shared })).rejects.toMatchObject({ code: "invalid_output" })
  })

  it("AC-2: a handler that throws a ChannelError keeps its code and message", async () => {
    const { rawRequest } = setup({
      "connection.get": () => {
        throw new ChannelError("engine_unreachable", "no engine is connected")
      },
    })
    await expect(rawRequest("connection.get", { serverId: shared })).rejects.toMatchObject({
      code: "engine_unreachable",
      message: "no engine is connected",
    })
  })

  it("AC-2: a handler that throws an ordinary error rejects with internal", async () => {
    const { rawRequest } = setup({
      "connection.get": () => {
        throw new Error("boom")
      },
    })
    await expect(rawRequest("connection.get", { serverId: shared })).rejects.toMatchObject({ code: "internal" })
  })

  it("AC-2: emit rejects a payload that violates the event schema", () => {
    const { server } = setup(handlers)
    expect(() => server.emit("connection.changed", { serverId: shared, state: { phase: "bogus" } } as never)).toThrow(
      ChannelError,
    )
  })

  it("AC-2: a malformed request is answered with invalid_message", () => {
    const transports = createMemoryTransportPair()
    createServer(transports.server, handlers)
    const responses: unknown[] = []
    transports.client.onMessage((message) => responses.push(message))
    transports.client.send({ v: 1, id: "req_1", type: "request", name: 42 })
    expect(responses).toEqual([
      {
        v: 1,
        id: "req_1",
        type: "response",
        name: "",
        error: { code: "invalid_message", message: expect.any(String) },
      },
    ])
  })

  it("AC-2: a malformed response rejects its pending request with invalid_message", async () => {
    const transports = createMemoryTransportPair()
    let sent: unknown
    const recording: Transport = {
      send: (message) => {
        sent = message
        transports.client.send(message)
      },
      onMessage: (handler) => transports.client.onMessage(handler),
      close: () => transports.client.close(),
    }
    const client = createClient(recording)
    const promise = client.request("connection.get", { serverId: shared })
    const id = (sent as { id: string }).id
    transports.server.send({ v: 1, id, type: "response", name: "connection.get", payload: "junk", error: 42 })
    await expect(promise).rejects.toMatchObject({ code: "invalid_message" })
  })
})

describe("channel lifecycle", () => {
  it("AC-4: unsubscribing stops delivery", () => {
    const { client, server } = setup(handlers)
    const seen: EventPayload<"connection.changed">[] = []
    const unsubscribe = client.subscribe("connection.changed", (payload) => seen.push(payload))
    server.emit("connection.changed", { serverId: shared, state: live })
    expect(seen).toHaveLength(1)
    unsubscribe()
    server.emit("connection.changed", { serverId: shared, state: live })
    expect(seen).toHaveLength(1)
  })

  it("AC-4: close rejects pending requests with aborted", async () => {
    const { client, rawRequest } = setup({ "servers.list": () => new Promise<never>(() => {}) })
    const promise = rawRequest("servers.list", undefined)
    client.close()
    await expect(promise).rejects.toMatchObject({ code: "aborted" })
  })

  it("AC-4: requests after close reject with aborted", async () => {
    const { client } = setup(handlers)
    client.close()
    await expect(client.request("servers.list", undefined)).rejects.toMatchObject({ code: "aborted" })
  })
})
