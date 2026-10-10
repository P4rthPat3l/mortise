import { requestId, serverId, sessionId } from "@mortise/domain"
import { describe, expect, it } from "vitest"
import { createAdapter } from "./adapter.js"

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

const noContent = (): Response => new Response(null, { status: 204 })

type Handler = (url: URL, init: RequestInit) => Response | undefined

const makeAdapter = (handler: Handler) =>
  createAdapter({
    serverId: serverId("test"),
    baseUrl: "http://engine.test",
    fetch: async (input, init) => {
      const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url)
      return handler(url, init ?? {}) ?? new Response("not found", { status: 404 })
    },
  })

const pendingBodies = (): Handler => (url) => {
  if (url.pathname === "/api/permission/request") {
    return json({
      location: { directory: "/work" },
      data: [{ id: "per_1", sessionID: "ses_1", action: "bash", resources: ["/etc/passwd"], message: "Allow?" }],
    })
  }
  if (url.pathname === "/api/form") {
    return json({
      location: { directory: "/work" },
      data: [
        {
          id: "frm_1",
          sessionID: "ses_1",
          title: "Setup",
          fields: [
            { key: "name", type: "string", title: "Name", required: true },
            { key: "env", type: "multiselect", options: [{ value: "prod", label: "Production" }] },
            { key: "login", type: "external", url: "https://example.com" },
          ],
        },
      ],
    })
  }
  return undefined
}

describe("pending requests", () => {
  it("lists permissions and forms and maps their fields", async () => {
    const adapter = makeAdapter(pendingBodies())
    const requests = await adapter.pendingRequests({ at: 999 })
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual({
      kind: "permission",
      id: "per_1",
      sessionId: "ses_1",
      title: "bash",
      detail: "Allow?",
      createdAt: 999,
    })
    expect(requests[1]).toEqual({
      kind: "form",
      id: "frm_1",
      sessionId: "ses_1",
      title: "Setup",
      createdAt: 999,
      questions: [
        { key: "name", type: "string", title: "Name", required: true },
        { key: "env", type: "multiselect", options: [{ value: "prod", label: "Production" }] },
        { key: "login", type: "external", url: "https://example.com" },
      ],
    })
  })
})

describe("answers", () => {
  it("sends a permission decision", async () => {
    let body: unknown
    const adapter = makeAdapter((url, init) => {
      if (url.pathname === "/api/session/ses_1/permission/per_1/reply") {
        body = JSON.parse(typeof init.body === "string" ? init.body : "{}")
        return noContent()
      }
      return undefined
    })
    await adapter.answerPermission({
      sessionId: sessionId("ses_1"),
      requestId: requestId("per_1"),
      decision: "always",
    })
    expect(body).toEqual({ decision: "always" })
  })

  it("sends a form answer and a form cancellation", async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const adapter = makeAdapter((url, init) => {
      if (url.pathname === "/api/session/ses_1/form/frm_1/reply") {
        calls.push({ path: url.pathname, body: JSON.parse(typeof init.body === "string" ? init.body : "{}") })
        return noContent()
      }
      if (url.pathname === "/api/session/ses_1/form/frm_1" && init.method === "DELETE") {
        calls.push({ path: url.pathname, body: init.body })
        return noContent()
      }
      return undefined
    })
    await adapter.answerForm({
      sessionId: sessionId("ses_1"),
      formId: requestId("frm_1"),
      answer: { name: "mortise" },
    })
    await adapter.cancelForm({ sessionId: sessionId("ses_1"), formId: requestId("frm_1") })
    expect(calls).toEqual([
      { path: "/api/session/ses_1/form/frm_1/reply", body: { answer: { name: "mortise" } } },
      { path: "/api/session/ses_1/form/frm_1", body: undefined },
    ])
  })
})
