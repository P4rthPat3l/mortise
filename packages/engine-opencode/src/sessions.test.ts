/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs"
import { messageId, serverId, sessionId } from "@mortise/domain"
import type { SessionInfo, SessionsResponse } from "@opencode/client"
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

type Handler = (url: URL, init: RequestInit) => Response | undefined

const makeFetch =
  (handler: Handler): typeof globalThis.fetch =>
  async (input, init) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url)
    return handler(url, init ?? {}) ?? new Response("not found", { status: 404 })
  }

const makeAdapter = (handler: Handler) =>
  createAdapter({ serverId: serverId("test"), baseUrl: "http://engine.test", fetch: makeFetch(handler) })

describe.each(VERSIONS)("session reads (%s)", (version) => {
  it("AC-1: list maps the recorded session list to summaries", async () => {
    const raw = fixture(version, "sessions-list.json") as SessionsResponse
    const adapter = makeAdapter((url) => (url.pathname === "/api/session" ? json(raw) : undefined))

    const sessions = await adapter.listSessions()

    expect(sessions).toHaveLength(raw.data.length)
    raw.data.forEach((info, index) => {
      expect(sessions[index]).toMatchObject({
        id: info.id,
        title: info.title ?? "",
        projectId: info.projectID,
        createdAt: info.time.created,
        updatedAt: info.time.updated,
        activity: "idle",
      })
      expect(sessions[index]?.directory).toBe(info.location.directory)
    })
    expect(sessions[0]?.directory).toContain("<sandbox>")
  })

  it("AC-1: get maps the recorded session to a summary", async () => {
    const raw = fixture(version, "session-get.json") as { data: SessionInfo }
    const adapter = makeAdapter((url) => (url.pathname === `/api/session/${raw.data.id}` ? json(raw) : undefined))

    const session = await adapter.getSession(sessionId(raw.data.id))

    expect(session).toMatchObject({
      id: raw.data.id,
      title: raw.data.title ?? "",
      projectId: raw.data.projectID,
      createdAt: raw.data.time.created,
      updatedAt: raw.data.time.updated,
      activity: "idle",
    })
    expect(session.directory).toBe(raw.data.location.directory)
  })

  it("AC-1: create maps the recorded session and sends the requested fields", async () => {
    const raw = fixture(version, "session-create.json") as { data: SessionInfo }
    let body: unknown
    const adapter = makeAdapter((url, init) => {
      if (url.pathname === "/api/session" && init.method === "POST") {
        body = JSON.parse(typeof init.body === "string" ? init.body : "{}")
        return json(raw)
      }
      return undefined
    })

    const session = await adapter.createSession({ directory: "/work", title: "Hello" })

    expect(session).toMatchObject({
      id: raw.data.id,
      title: raw.data.title ?? "",
      projectId: raw.data.projectID,
    })
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
