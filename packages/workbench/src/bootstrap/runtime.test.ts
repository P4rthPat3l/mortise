import { messageId, serverId, sessionId } from "@mortise/domain"
import {
  type Channel,
  type ChannelServer,
  createClient,
  createMemoryTransportPair,
  createServer,
  type MethodHandlers,
} from "@mortise/rpc-contracts"
import { afterEach, describe, expect, it } from "vitest"
import type { FrameScheduler } from "./frame"
import { createWorkbenchRuntime, type WorkbenchRuntime } from "./runtime"

const SERVER = serverId("server-test")
const SESSION = sessionId("ses_1")
const USER_MESSAGE = messageId("msg_1")

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

const liveInfo = {
  version: "2.0.26",
  capabilities: { pairing: true, persistentTerminals: false, forkBeforeMessage: true, experimental: new Set<string>() },
  support: "supported" as const,
}

interface Harness {
  readonly channel: Channel
  readonly server: ChannelServer
  readonly scheduler: ManualScheduler
  readonly paths: string[]
  sessionsFail: boolean
}

const harness = (): Harness => {
  const pair = createMemoryTransportPair()
  const paths: string[] = []
  const mutable = { sessionsFail: false }

  const handlers: Partial<MethodHandlers> = {
    "servers.list": () => [{ id: SERVER, label: "Test", kind: "shared", url: "http://engine.test" }],
    "connection.get": () => ({ phase: "live", info: liveInfo }),
    "engine.fetch": (input) => {
      paths.push(input.path)
      if (input.path === "/api/session") {
        if (mutable.sessionsFail) throw new Error("list failed")
        return json({
          data: [
            {
              id: SESSION,
              projectID: "prj_1",
              title: "First",
              time: { created: 1, updated: 2 },
              location: { directory: "/work" },
            },
          ],
        })
      }
      if (input.path === "/api/session/active") return json({ data: {} })
      if (input.path === "/api/permission/request" || input.path === "/api/form") return json({ data: [] })
      if (input.path.endsWith("/message")) return json({ data: [] })
      if (input.path.endsWith("/prompt")) return json({ data: { id: USER_MESSAGE } })
      return { status: 404, headers: {}, body: { kind: "text" as const, text: "" } }
    },
  }

  const server = createServer(pair.server, handlers)
  return {
    channel: createClient(pair.client),
    server,
    scheduler: new ManualScheduler(),
    paths,
    get sessionsFail() {
      return mutable.sessionsFail
    },
    set sessionsFail(value: boolean) {
      mutable.sessionsFail = value
    },
  }
}

const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${message}`)
}

const runtimes: WorkbenchRuntime[] = []
const start = async (h: Harness): Promise<WorkbenchRuntime> => {
  const runtime = await createWorkbenchRuntime({ channel: h.channel, scheduler: h.scheduler, pageSize: 10 })
  runtimes.push(runtime)
  await runtime.ready
  return runtime
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
})

const userEnqueued = (text: string) => ({
  id: "evt_msg_1",
  created: 10,
  type: "session.inbox.enqueued",
  data: {
    sessionID: SESSION,
    inboxID: USER_MESSAGE,
    item: { type: "user", payload: { text } },
  },
})

describe("BR-005 event batches apply once per frame", () => {
  it("holds translated patches until the scheduler runs", async () => {
    const h = harness()
    const runtime = await start(h)
    await waitFor(() => runtime.timeline.itemIds(SESSION).length === 0, "the empty timeline")

    h.server.emit("engine.events", {
      serverId: SERVER,
      generation: 1,
      events: [userEnqueued("hello")],
    })

    expect(runtime.timeline.itemIds(SESSION)).toEqual([])

    h.scheduler.flush()

    expect(runtime.timeline.itemIds(SESSION)).toEqual([USER_MESSAGE])
    expect(runtime.timeline.item(SESSION, USER_MESSAGE)).toMatchObject({ kind: "user" })
  })
})

describe("BR-006 resync refetches visible state", () => {
  it("reads sessions, active sessions, pending requests and the visible page", async () => {
    const h = harness()
    const runtime = await start(h)
    await waitFor(() => runtime.sessions.store.getSnapshot().status === "ready", "the session list")

    h.paths.length = 0
    h.server.emit("engine.resync", { serverId: SERVER, generation: 2, reason: "overflow" })

    await waitFor(
      () =>
        h.paths.includes("/api/session") &&
        h.paths.includes("/api/session/active") &&
        h.paths.includes("/api/permission/request") &&
        h.paths.includes("/api/form") &&
        h.paths.some((path) => path.endsWith("/message")),
      "the resync reads",
    )

    expect(runtime.sessions.store.getSnapshot().sessions).toHaveLength(1)
    expect(runtime.sessions.store.getSnapshot().status).toBe("ready")
  })

  it("keeps the previous sessions when the refetch fails", async () => {
    const h = harness()
    const runtime = await start(h)
    await waitFor(() => runtime.sessions.store.getSnapshot().status === "ready", "the session list")

    h.sessionsFail = true
    h.server.emit("engine.resync", { serverId: SERVER, generation: 3, reason: "gap" })

    await waitFor(() => runtime.sessions.store.getSnapshot().status === "error", "the failed refetch")
    expect(runtime.sessions.store.getSnapshot().sessions).toHaveLength(1)
    expect(runtime.sessions.store.getSnapshot().error).toBeTruthy()
  })
})

describe("BR-003 a failed fetch is not an empty list", () => {
  it("reports the error instead of ready-with-no-sessions", async () => {
    const h = harness()
    h.sessionsFail = true
    const runtime = await start(h)

    expect(runtime.sessions.store.getSnapshot()).toMatchObject({ status: "error", sessions: [] })
    expect(runtime.sessions.store.getSnapshot().error).toBeTruthy()
  })
})
