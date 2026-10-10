/// <reference types="node" />
import { readFileSync } from "node:fs"
import { messageId, serverId, sessionId } from "@mortise/domain"
import { describe, expect, it } from "vitest"
import { createAdapter } from "./adapter.js"

const FIXTURES = new URL("../fixtures/2.0.26/", import.meta.url)

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"))

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

type Handler = (url: URL, init: RequestInit) => Response | undefined

const makeFetch =
  (handler: Handler): typeof globalThis.fetch =>
  async (input, init) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url)
    return handler(url, init ?? {}) ?? new Response("not found", { status: 404 })
  }

const makeAdapter = (handler: Handler) =>
  createAdapter({ serverId: serverId("test"), baseUrl: "http://engine.test", fetch: makeFetch(handler) })

describe("session reads", () => {
  it("AC-1: list maps the recorded session list to summaries", async () => {
    const adapter = makeAdapter((url) =>
      url.pathname === "/api/session" ? json(fixture("sessions-list.json")) : undefined,
    )
    const sessions = await adapter.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      id: "ses_ed9eb15bcffetgood7Gtp6WZN1",
      title: "",
      projectId: "f901891a2ac2abc6a81ebae2b032586da6c88ced",
      createdAt: 1791640267352,
      updatedAt: 1791640267352,
      activity: "idle",
    })
  })

  it("AC-1: get maps the recorded session to a summary", async () => {
    const adapter = makeAdapter((url) =>
      url.pathname === "/api/session/ses_ed9eb15bcffetgood7Gtp6WZN1" ? json(fixture("session-get.json")) : undefined,
    )
    const session = await adapter.getSession(sessionId("ses_ed9eb15bcffetgood7Gtp6WZN1"))
    expect(session.projectId).toBe("f901891a2ac2abc6a81ebae2b032586da6c88ced")
    expect(session.directory).toContain("sandbox-erFVvh/work")
  })

  it("AC-1: create maps the recorded session and sends the requested fields", async () => {
    let body: unknown
    const adapter = makeAdapter((url, init) => {
      if (url.pathname === "/api/session" && init.method === "POST") {
        body = JSON.parse(typeof init.body === "string" ? init.body : "{}")
        return json(fixture("session-create.json"))
      }
      return undefined
    })
    const session = await adapter.createSession({ directory: "/work", title: "Hello" })
    expect(session.id).toBe("ses_ed9eb15bcffetgood7Gtp6WZN1")
    expect(body).toEqual({ location: { directory: "/work" }, title: "Hello" })
  })
})

describe("prompt", () => {
  it("AC-4: the same clientMessageId sends the same id and only declared fields", async () => {
    const bodies: string[] = []
    const adapter = makeAdapter((url, init) => {
      if (url.pathname.endsWith("/prompt")) {
        bodies.push(typeof init.body === "string" ? init.body : "")
        return json({ data: { id: "msg_x" } })
      }
      return undefined
    })

    const target = sessionId("ses_ed9eb15bcffetgood7Gtp6WZN1")
    const id = messageId("msg_fixed")
    await adapter.prompt({ sessionId: target, text: "List files", clientMessageId: id })
    await adapter.prompt({ sessionId: target, text: "List files", clientMessageId: id })

    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1])
    const parsed = JSON.parse(bodies[0] ?? "{}") as Record<string, unknown>
    expect(parsed).toEqual({ id, text: "List files" })
    expect(Object.keys(parsed).sort()).toEqual(["id", "text"])
  })
})
