import { serverId } from "@mortise/domain"
import { describe, expect, it } from "vitest"
import type { Discovery, ServiceEndpoint } from "./discovery.js"
import { type ConnectionChange, createGateway, type Gateway } from "./gateway.js"
import { createLogger, type LogFields, type LogLevel, type LogSink } from "./logging.js"

const SERVER = serverId("server-1")

const ENDPOINT: ServiceEndpoint = {
  url: "http://127.0.0.1:49374",
  auth: { type: "basic", username: "opencode", password: "s3cr3t-password" },
}

const INFO = { version: "2.0.26", pid: 7, capabilities: { persistentPty: true } }

interface Capture {
  readonly gateway: Gateway
  readonly changes: ConnectionChange[]
  readonly lines: Array<{ level: LogLevel; message: string; fields: LogFields }>
}

function createHarness(): Capture {
  const discovery: Discovery = {
    discover: async () => ENDPOINT,
    findOrStart: async () => ({ kind: "found", endpoint: ENDPOINT }),
  }
  const lines: Capture["lines"] = []
  const sink: LogSink = { write: (level, message, fields) => lines.push({ level, message, fields }) }
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url
    if (url.endsWith("/api/info")) return new Response(JSON.stringify(INFO), { status: 200 })
    if (url.endsWith("/openapi.json")) return new Response(JSON.stringify({ paths: {} }), { status: 200 })
    return new Response("nope", { status: 404 })
  }
  const gateway = createGateway({
    serverId: SERVER,
    discovery,
    fetch,
    logger: createLogger(sink),
    label: "Shared OpenCode",
  })
  const changes: ConnectionChange[] = []
  gateway.onConnectionChange((change) => changes.push(change))
  return { gateway, changes, lines }
}

describe("gateway composition", () => {
  it("BR-018: serves one shared server and reads connection state freshly", async () => {
    const harness = createHarness()
    expect(harness.gateway.servers()).toEqual([{ id: SERVER, label: "Shared OpenCode", kind: "shared", url: "" }])
    await harness.gateway.start()
    expect(harness.gateway.connection(SERVER)).toEqual({ phase: "connecting", url: ENDPOINT.url })
    expect(harness.gateway.servers()).toEqual([
      { id: SERVER, label: "Shared OpenCode", kind: "shared", url: ENDPOINT.url },
    ])

    harness.gateway.internal.connection.onStreamConnected()
    expect(harness.gateway.connection(SERVER).phase).toBe("live")
  })

  it("AC-1: emits connection.changed transitions tagged with the server id", async () => {
    const harness = createHarness()
    await harness.gateway.start()
    expect(harness.changes.map((change) => change.state.phase)).toEqual(["discovering", "connecting"])
    expect(harness.changes.every((change) => change.serverId === SERVER)).toBe(true)
  })

  it("BR-018: rejects an unknown server id", async () => {
    const harness = createHarness()
    expect(() => harness.gateway.connection(serverId("other"))).toThrow()
    await expect(harness.gateway.retry(serverId("other"))).rejects.toThrow()
  })

  it("AC-5 / SEC-001: keeps the password internal and out of every public value and log line", async () => {
    const harness = createHarness()
    await harness.gateway.start()
    harness.gateway.internal.connection.onStreamConnected()

    const publicValues = JSON.stringify([
      harness.gateway.servers(),
      harness.gateway.connection(SERVER),
      harness.changes,
    ])
    expect(publicValues).not.toContain("s3cr3t-password")
    expect(JSON.stringify(harness.lines)).not.toContain("s3cr3t-password")

    expect(harness.gateway.internal.endpoint()?.auth?.password).toBe("s3cr3t-password")
    expect(harness.gateway.internal.info()?.version).toBe("2.0.26")
  })
})
