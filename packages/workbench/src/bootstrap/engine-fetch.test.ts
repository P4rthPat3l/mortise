import { serverId } from "@mortise/domain"
import {
  ChannelError,
  createClient,
  createMemoryTransportPair,
  createServer,
  type MethodHandlers,
} from "@mortise/rpc-contracts"
import { describe, expect, it } from "vitest"
import { createGatewayFetch } from "./engine-fetch.js"

const SERVER = serverId("server-1")

const linkedChannel = (handlers: Partial<MethodHandlers>) => {
  const pair = createMemoryTransportPair()
  const server = createServer(pair.server, handlers)
  const channel = createClient(pair.client)
  return { channel, server }
}

describe("BR-002 gateway fetch encodes and decodes engine.fetch", () => {
  it("forwards method, path, repeated query values, headers and a text body", async () => {
    let seen: unknown
    const { channel } = linkedChannel({
      "engine.fetch": (input) => {
        seen = input
        return { status: 200, headers: { "content-type": "application/json" }, body: { kind: "text", text: "{}" } }
      },
    })
    const gatewayFetch = createGatewayFetch(channel, SERVER)

    const response = await gatewayFetch(
      "http://engine.invalid/api/session/ses_1/message?limit=2&type=user&type=assistant",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-test": "yes" },
        body: JSON.stringify({ text: "hello" }),
      },
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("{}")
    expect(seen).toEqual({
      serverId: SERVER,
      method: "POST",
      path: "/api/session/ses_1/message",
      query: { limit: "2", type: ["user", "assistant"] },
      headers: { "content-type": "application/json", "x-test": "yes" },
      body: { kind: "text", text: '{"text":"hello"}' },
    })
  })

  it("sends a null body for a GET", async () => {
    let body: unknown = "not set"
    const { channel } = linkedChannel({
      "engine.fetch": (input) => {
        body = input.body
        return { status: 204, headers: {}, body: null }
      },
    })

    const response = await createGatewayFetch(channel, SERVER)("http://engine.invalid/api/session")

    expect(body).toBeNull()
    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")
  })

  it("decodes a base64 response body", async () => {
    const { channel } = linkedChannel({
      "engine.fetch": () => ({
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: { kind: "base64", data: btoa(String.fromCharCode(1, 2, 3)) },
      }),
    })

    const response = await createGatewayFetch(channel, SERVER)("http://engine.invalid/api/file")

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it("passes a channel failure through as a rejected fetch", async () => {
    const { channel } = linkedChannel({
      "engine.fetch": () => {
        throw new ChannelError("engine_unreachable", "no engine is connected")
      },
    })

    await expect(createGatewayFetch(channel, SERVER)("http://engine.invalid/api/session")).rejects.toThrow(
      "no engine is connected",
    )
  })
})
