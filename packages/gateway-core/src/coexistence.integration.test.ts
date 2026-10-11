// Coexistence and resilience against a real engine (FEAT-001 §20, §P1, §P2, §AC-001, §AC-002,
// §AC-005, §BR-001, §BR-010, §SEC-006). Skipped unless MORTISE_INTEGRATION=1. The real shared
// service is touched only by the read-only test, and only when MORTISE_SHARED_SERVICE_TEST=1.
//
// The sandbox scripts live in the @mortise/scripts workspace; AGENTS.md's testing section directs
// integration tests to start an engine with `startSandbox` from there.
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { type ServerId, serverId } from "@mortise/domain"
import { describe, expect, it } from "vitest"
import {
  resolveInstalledBinary,
  resolveSandboxBinary,
  type Sandbox,
  serviceRegistrationFile,
  startSandbox,
} from "../../../scripts/engine-sandbox.js"
import { fakeProviderConfig, startFakeProvider } from "../../../scripts/fake-provider.js"
import {
  basicAuthHeaders,
  consoleSink,
  createDiscovery,
  createGateway,
  createLogger,
  type Discovery,
  type EngineStreamEvent,
  type Gateway,
  openCodeServiceClient,
} from "./index.js"

const SERVER = serverId("server-shared")

/** The user's real registration file, the one the read-only test must not disturb. */
const USER_SERVICE_FILE = join(homedir(), ".local", "state", "opencode", "service.json")

/** Prefer the installed v2 engine; `bunx` is a last resort because it downloads every platform. */
function sandboxBinary(): "installed" | "bunx" {
  return resolveInstalledBinary() === undefined ? "bunx" : "installed"
}

interface Registration {
  readonly id: string
  readonly pid: number
  readonly version: string
  readonly url: string
}

async function readRegistration(file: string): Promise<Registration> {
  return JSON.parse(await readFile(file, "utf8")) as Registration
}

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

function discoveryAt(file: string, onEnsure: () => void): Discovery {
  const inner = openCodeServiceClient()
  return createDiscovery({
    client: {
      discover: (options) => inner.discover({ ...options, file }),
      // A registration exists in every test that uses this; if ensure were reached the test must
      // fail loudly instead of spawning a service in the user's own directories (BR-001, BR-002).
      ensure: async () => {
        onEnsure()
        throw new Error("ensure() must never be called while a registration exists")
      },
    },
    findCli: async () => true,
  })
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${message}`)
}

async function createSession(url: string, password: string): Promise<string> {
  const response = await fetch(`${url}/api/session`, {
    method: "POST",
    headers: { authorization: basicAuth(password), "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  const body = (await response.json()) as { readonly data?: { readonly id?: unknown } }
  const id = body.data?.id
  if (typeof id !== "string") throw new Error(`session create did not return an id: ${response.status}`)
  return id
}

async function prompt(url: string, password: string, sessionID: string, text: string): Promise<void> {
  const response = await fetch(`${url}/api/session/${sessionID}/prompt`, {
    method: "POST",
    headers: { authorization: basicAuth(password), "content-type": "application/json" },
    body: JSON.stringify({ text, id: `msg_${Date.now().toString(36)}` }),
  })
  if (!response.ok) throw new Error(`prompt failed with ${response.status}`)
}

async function messages(url: string, password: string, sessionID: string): Promise<string> {
  const response = await fetch(`${url}/api/session/${sessionID}/message`, {
    headers: { authorization: basicAuth(password) },
  })
  if (!response.ok) throw new Error(`message read failed with ${response.status}`)
  return JSON.stringify(await response.json())
}

function eventSessionId(event: unknown): string | undefined {
  const data = (event as { readonly data?: { readonly sessionID?: unknown } } | undefined)?.data
  return typeof data?.sessionID === "string" ? data.sessionID : undefined
}

/**
 * Wraps the global fetch so the test can fail the gateway's `/api/event` reader on demand, the way
 * a network loss or a server restart does. The gateway injects this same fetch (T-005).
 */
function controllableFetch(base: typeof globalThis.fetch): {
  readonly fetch: typeof globalThis.fetch
  readonly dropEventStream: () => boolean
} {
  let drop: (() => void) | undefined
  const wrapped: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const response = await base(input, init)
    if (!url.includes("/api/event") || response.body === null) return response
    const reader = response.body.getReader()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(next) {
        controller = next
      },
      async pull(next) {
        try {
          const chunk = await reader.read()
          if (chunk.done) next.close()
          else next.enqueue(chunk.value)
        } catch (cause) {
          next.error(cause)
        }
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })
    drop = () => controller?.error(new Error("event stream dropped by test"))
    return new Response(stream, { status: response.status, headers: response.headers })
  }
  return {
    fetch: wrapped,
    dropEventStream: () => {
      const armed = drop !== undefined
      drop?.()
      drop = undefined
      return armed
    },
  }
}

function gatewayFor(options: {
  readonly serverId: ServerId
  readonly discovery: Discovery
  readonly fetch: typeof globalThis.fetch
}): Gateway {
  return createGateway({
    serverId: options.serverId,
    discovery: options.discovery,
    fetch: options.fetch,
    logger: createLogger(consoleSink()),
  })
}

describe.skipIf(!process.env.MORTISE_INTEGRATION)("FEAT-001 coexistence and resilience", () => {
  it("BR-001 / AC-1 / P1: joins a sandboxed service and leaves its registration untouched", async () => {
    const sandbox = await startSandbox({ binary: sandboxBinary(), service: true })
    const file = serviceRegistrationFile(sandbox.dirs)
    const before = await readFile(file, "utf8")
    let ensureCalls = 0
    const gateway = gatewayFor({
      serverId: SERVER,
      discovery: discoveryAt(file, () => (ensureCalls += 1)),
      fetch: globalThis.fetch,
    })
    const unsubscribe = gateway.internal.events.subscribe(() => {})
    try {
      await gateway.start()
      await waitFor(() => gateway.connection(SERVER).phase === "live", 20_000, "the gateway to reach live")
      expect(ensureCalls).toBe(0)
      expect(await readFile(file, "utf8")).toBe(before)
      const registration = JSON.parse(before) as Registration
      expect(registration.pid).toBe(sandbox.pid)
      expect(registration.url).toBe(sandbox.url)
      expect(gateway.servers()[0]?.url).toBe(sandbox.url)
    } finally {
      unsubscribe()
      gateway.dispose()
      await sandbox.dispose()
    }
  })

  it("BR-010 / CASE-006 / P1: rejoins after another engine replaces the registration", async () => {
    const first = await startSandbox({ binary: sandboxBinary(), service: true })
    const file = serviceRegistrationFile(first.dirs)
    const firstInfo = await readRegistration(file)
    let ensureCalls = 0
    const gateway = gatewayFor({
      serverId: SERVER,
      discovery: discoveryAt(file, () => (ensureCalls += 1)),
      fetch: globalThis.fetch,
    })
    const unsubscribe = gateway.internal.events.subscribe(() => {})
    let second: Sandbox | undefined
    try {
      await gateway.start()
      await waitFor(() => gateway.connection(SERVER).phase === "live", 20_000, "the gateway to reach live")

      // A second service shares the same XDG_STATE_HOME, so it overwrites the registration the way
      // the official app or a TUI does. A different version exercises the version recheck.
      const replacement = resolveSandboxBinary("2.0.20")
      second = await startSandbox({
        binary: replacement === undefined ? sandboxBinary() : { path: replacement },
        service: true,
        stateDir: first.dirs.state,
      })
      await waitFor(
        async () => (await readRegistration(file)).pid === second?.pid,
        20_000,
        "the replacement to register",
      )

      // The host notices the change and tells the machine; the gateway itself never spawns or stops.
      await gateway.internal.connection.onRegistrationReplaced()
      await waitFor(() => gateway.connection(SERVER).phase === "live", 20_000, "the gateway to rejoin")
      expect(ensureCalls).toBe(0)
      expect(gateway.servers()[0]?.url).toBe(second.url)
      if (replacement !== undefined) {
        expect((await readRegistration(file)).version).not.toBe(firstInfo.version)
      }
    } finally {
      unsubscribe()
      gateway.dispose()
      await second?.dispose()
      await first.dispose()
    }
  })

  it.skipIf(process.env.MORTISE_SHARED_SERVICE_TEST !== "1")(
    "SEC-006 / AC-2 / ADR-0002: reads the user's shared service without touching it",
    async () => {
      const before = await readFile(USER_SERVICE_FILE).catch(() => undefined)
      const endpoint = await openCodeServiceClient().discover()
      // No shared service running: nothing to read, and the file must still be unchanged.
      if (endpoint !== undefined) {
        const response = await fetch(new URL("/api/info", endpoint.url), { headers: basicAuthHeaders(endpoint) })
        expect(response.status).toBe(200)
        const info = (await response.json()) as { readonly version?: unknown; readonly pid?: unknown }
        expect(typeof info.version).toBe("string")
        expect(typeof info.pid).toBe("number")
      }
      expect(await readFile(USER_SERVICE_FILE).catch(() => undefined)).toEqual(before)
    },
  )

  it("BR-015 / AC-5 / P2: a dropped stream mid-turn resyncs, reconnects, and loses no committed state", async () => {
    const provider = await startFakeProvider()
    const sandbox = await startSandbox({
      binary: sandboxBinary(),
      service: true,
      config: fakeProviderConfig(provider.url),
    })
    const file = serviceRegistrationFile(sandbox.dirs)
    const controlled = controllableFetch(globalThis.fetch)
    let ensureCalls = 0
    const gateway = gatewayFor({
      serverId: SERVER,
      discovery: discoveryAt(file, () => (ensureCalls += 1)),
      fetch: controlled.fetch,
    })
    const batches: EngineStreamEvent[] = []
    const unsubscribe = gateway.internal.events.subscribe((event) => batches.push(event))
    try {
      await gateway.start()
      await waitFor(() => gateway.connection(SERVER).phase === "live", 20_000, "the gateway to reach live")

      const sessionID = await createSession(sandbox.url, sandbox.password)
      await prompt(sandbox.url, sandbox.password, sessionID, "List the text files in the working directory.")
      await waitFor(
        () =>
          batches.some(
            (event) => event.type === "engine.events" && event.events.some((raw) => eventSessionId(raw) === sessionID),
          ),
        20_000,
        "the turn's first events",
      )

      // Close the upstream reader. The stream reconnects with backoff under a new generation.
      expect(controlled.dropEventStream()).toBe(true)
      await waitFor(
        () => batches.some((event) => event.type === "engine.resync" && event.generation >= 2),
        20_000,
        "an engine.resync of generation 2",
      )
      await waitFor(() => gateway.connection(SERVER).phase === "live", 20_000, "the gateway to reconnect")

      await waitFor(
        async () => (await messages(sandbox.url, sandbox.password, sessionID)).includes("Sandbox turn complete."),
        30_000,
        "the turn's final assistant text",
      )
      const snapshot = await messages(sandbox.url, sandbox.password, sessionID)
      expect(snapshot).toContain("List the text files in the working directory.")
      expect(snapshot).toContain("Sandbox turn complete.")
      expect(ensureCalls).toBe(0)
    } finally {
      unsubscribe()
      gateway.dispose()
      await sandbox.dispose()
      await provider.stop()
    }
  })
})
