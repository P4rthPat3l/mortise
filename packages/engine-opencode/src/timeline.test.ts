/// <reference types="node" />
import { readFileSync } from "node:fs"
import { serverId, sessionId } from "@mortise/domain"
import { describe, expect, it } from "vitest"
import { createAdapter } from "./adapter.js"

const FIXTURES = new URL("../fixtures/2.0.26/", import.meta.url)

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"))

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

describe("timeline", () => {
  it("AC-1: maps the recorded message page to a chronological timeline", async () => {
    const adapter = createAdapter({
      serverId: serverId("test"),
      baseUrl: "http://engine.test",
      fetch: async (input) => {
        const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url)
        return url.pathname.endsWith("/message")
          ? json(fixture("messages.json"))
          : new Response("not found", { status: 404 })
      },
    })

    const items = await adapter.timeline(sessionId("ses_ed9eb15bcffetgood7Gtp6WZN1"))

    expect(items.map((item) => item.kind)).toEqual(["user", "assistant", "assistant"])
    expect(items[0]).toMatchObject({
      kind: "user",
      id: "msg_12614eaa9001qNsStmsEkmJ3ml",
      createdAt: 1791640267798,
      parts: [
        {
          kind: "text",
          id: "msg_12614eaa9001qNsStmsEkmJ3ml:text:0",
          text: "List the text files in the working directory.",
        },
      ],
    })

    const assistant = items[1]
    expect(assistant?.parts[0]).toEqual({
      kind: "text",
      id: "msg_12614ec26001mc5D7ELH2Aaflh:text:0",
      text: "Let me look. ",
    })
    expect(assistant?.parts[1]).toEqual({
      kind: "tool",
      id: "call_fake_1",
      callId: "call_fake_1",
      tool: "glob",
      state: "success",
      input: { pattern: "*.txt" },
      output: [{ type: "text", text: "No files found" }],
      metadata: { count: 0, truncated: false },
      error: undefined,
    })

    expect(items[2]?.parts).toEqual([
      { kind: "text", id: "msg_12614ec8a001Jogwo2M3D2KiOv:text:0", text: "Sandbox turn complete." },
    ])
  })
})
