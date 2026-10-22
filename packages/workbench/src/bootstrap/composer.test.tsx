// @vitest-environment happy-dom
import { serverId } from "@mortise/domain"
import { createClient, createMemoryTransportPair, createServer, type MethodHandlers } from "@mortise/rpc-contracts"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ComposerPanel } from "../modules/composer/view"
import type { FrameScheduler } from "./frame"
import { createWorkbenchRuntime, type WorkbenchRuntime } from "./runtime"

const SERVER = serverId("server-prompt")
const SESSION_ID = "ses_prompt"

class ManualScheduler implements FrameScheduler {
  private callbacks: Array<() => void> = []

  schedule(callback: () => void): void {
    this.callbacks.push(callback)
  }

  flush(): void {
    const callbacks = this.callbacks
    this.callbacks = []
    for (const callback of callbacks) callback()
  }
}

const json = (body: unknown) => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: { kind: "text" as const, text: JSON.stringify(body) },
})

const runtimes: WorkbenchRuntime[] = []
afterEach(() => {
  cleanup()
  for (const runtime of runtimes.splice(0)) runtime.dispose()
})

describe("AC-003 a retried prompt is admitted once", () => {
  it("reuses the client message id and still shows one user message", async () => {
    const pair = createMemoryTransportPair()
    const scheduler = new ManualScheduler()
    const bodies: Array<{ id: string; text: string }> = []
    let promptCalls = 0
    let server: ReturnType<typeof createServer> | undefined

    const handlers: Partial<MethodHandlers> = {
      "servers.list": () => [{ id: SERVER, label: "Test", kind: "shared", url: "http://engine.test" }],
      "connection.get": () => ({
        phase: "live",
        info: {
          version: "2.0.26",
          capabilities: {
            pairing: true,
            persistentTerminals: false,
            forkBeforeMessage: true,
            experimental: new Set<string>(),
          },
          support: "supported",
        },
      }),
      "engine.fetch": (input) => {
        if (input.path === "/api/session") {
          return json({
            data: [
              {
                id: SESSION_ID,
                projectID: "prj_1",
                title: "Prompt",
                time: { created: 1, updated: 2 },
                location: { directory: "/work" },
              },
            ],
          })
        }
        if (input.path === "/api/session/active") return json({ data: {} })
        if (input.path === "/api/permission/request" || input.path === "/api/form") return json({ data: [] })
        if (input.path.endsWith("/message")) return json({ data: [] })
        if (input.path.endsWith("/prompt")) {
          const body = JSON.parse(input.body !== null && input.body.kind === "text" ? input.body.text : "{}") as {
            id: string
            text: string
          }
          bodies.push(body)
          promptCalls += 1
          if (promptCalls === 1) {
            // The engine admitted the prompt, then the reply was lost.
            server?.emit("engine.events", {
              serverId: SERVER,
              generation: 1,
              events: [
                {
                  id: "evt_prompt",
                  created: 1,
                  type: "session.inbox.enqueued",
                  data: {
                    sessionID: SESSION_ID,
                    inboxID: body.id,
                    item: { type: "user", payload: { text: body.text } },
                  },
                },
              ],
            })
            throw new Error("reply lost")
          }
          return json({ data: { id: body.id } })
        }
        return { status: 404, headers: {}, body: { kind: "text" as const, text: "" } }
      },
    }

    server = createServer(pair.server, handlers)
    const runtime = await createWorkbenchRuntime({
      channel: createClient(pair.client),
      scheduler,
      pageSize: 10,
    })
    runtimes.push(runtime)
    await runtime.ready

    render(<ComposerPanel sessions={runtime.sessions} service={runtime.composerService} />)

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "hello engine" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined())

    scheduler.flush()
    const session = runtime.sessions.store.getSnapshot().selectedId
    if (session === undefined) throw new Error("a session should be selected")
    expect(runtime.timeline.items(session)).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(promptCalls).toBe(2))

    expect(bodies).toHaveLength(2)
    expect(bodies[0]?.id).toBe(bodies[1]?.id)
    expect(bodies[0]?.text).toBe("hello engine")
    expect(runtime.timeline.items(session)).toHaveLength(1)
    expect(runtime.timeline.items(session)[0]?.id).toBe(bodies[0]?.id)
  })
})

describe("AC-003 retry after a changed draft", () => {
  it("does not reuse an id for a different prompt", async () => {
    const pair = createMemoryTransportPair()
    const bodies: Array<{ id: string; text: string }> = []
    let fail = true

    const handlers: Partial<MethodHandlers> = {
      "servers.list": () => [{ id: SERVER, label: "Test", kind: "shared", url: "http://engine.test" }],
      "connection.get": () => ({ phase: "discovering" }),
      "engine.fetch": (input) => {
        if (input.path === "/api/session") {
          return json({
            data: [
              {
                id: SESSION_ID,
                projectID: "prj_1",
                title: "Prompt",
                time: { created: 1, updated: 2 },
                location: { directory: "/work" },
              },
            ],
          })
        }
        if (input.path === "/api/session/active") return json({ data: {} })
        if (input.path === "/api/permission/request" || input.path === "/api/form") return json({ data: [] })
        if (input.path.endsWith("/message")) return json({ data: [] })
        if (input.path.endsWith("/prompt")) {
          const body = JSON.parse(input.body !== null && input.body.kind === "text" ? input.body.text : "{}") as {
            id: string
            text: string
          }
          bodies.push(body)
          if (fail) {
            fail = false
            throw new Error("offline")
          }
          return json({ data: { id: body.id } })
        }
        return { status: 404, headers: {}, body: { kind: "text" as const, text: "" } }
      },
    }
    createServer(pair.server, handlers)
    const scheduler = new ManualScheduler()
    const runtime = await createWorkbenchRuntime({ channel: createClient(pair.client), scheduler, pageSize: 10 })
    runtimes.push(runtime)
    await runtime.ready

    render(<ComposerPanel sessions={runtime.sessions} service={runtime.composerService} />)
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "first" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined())

    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "second" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(bodies).toHaveLength(2))

    expect(bodies[0]?.id).not.toBe(bodies[1]?.id)
  })
})
