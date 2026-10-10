/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs"
import { serverId, sessionId } from "@mortise/domain"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessagesResponse,
  SessionMessageUser,
} from "@opencode/client"
import { describe, expect, it } from "vitest"
import { createAdapter } from "./adapter.js"

// One contract run per recorded engine version (T-014).
const FIXTURES_ROOT = new URL("../fixtures/", import.meta.url)
const VERSIONS = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const fixture = (version: string, name: string): unknown =>
  JSON.parse(readFileSync(new URL(`${version}/${name}`, FIXTURES_ROOT), "utf8"))

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

describe.each(VERSIONS)("timeline (%s)", (version) => {
  it("AC-1: maps the recorded message page to a chronological timeline", async () => {
    const raw = fixture(version, "messages.json") as SessionMessagesResponse
    const user = raw.data.find((message): message is SessionMessageUser => message.type === "user")
    const assistants = raw.data
      .filter((message): message is SessionMessageAssistant => message.type === "assistant")
      .sort((left, right) => left.time.created - right.time.created)
    const first = assistants[0]
    const second = assistants[1]
    if (user === undefined || first === undefined || second === undefined) {
      throw new Error(`fixture ${version} does not have one user and two assistant messages`)
    }
    const tool = first.content.find((part): part is SessionMessageAssistantTool => part.type === "tool")
    if (tool === undefined) throw new Error(`fixture ${version} has no tool call in the first assistant message`)

    const adapter = createAdapter({
      serverId: serverId("test"),
      baseUrl: "http://engine.test",
      fetch: async (input) => {
        const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url)
        return url.pathname.endsWith("/message") ? json(raw) : new Response("not found", { status: 404 })
      },
    })

    const items = await adapter.timeline(sessionId(user.id))

    expect(items.map((item) => item.kind)).toEqual(["user", "assistant", "assistant"])
    expect(items[0]).toMatchObject({
      kind: "user",
      id: user.id,
      createdAt: user.time.created,
      parts: [{ kind: "text", id: `${user.id}:text:0`, text: user.text }],
    })
    expect(items[1]).toMatchObject({
      kind: "assistant",
      id: first.id,
      createdAt: first.time.created,
      parts: [
        { kind: "text", id: `${first.id}:text:0`, text: "Let me look. " },
        {
          kind: "tool",
          id: tool.id,
          callId: tool.id,
          tool: "glob",
          state: "success",
          input: { pattern: "*.txt" },
          output: [{ type: "text", text: "No files found" }],
          metadata: { count: 0, truncated: false },
        },
      ],
    })
    expect(items[2]).toMatchObject({
      kind: "assistant",
      id: second.id,
      createdAt: second.time.created,
      parts: [{ kind: "text", id: `${second.id}:text:0`, text: "Sandbox turn complete." }],
    })
  })
})
