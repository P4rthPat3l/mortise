import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { serverId } from "@mortise/domain"
import type { MethodInput } from "@mortise/rpc-contracts"
import { afterEach, describe, expect, it } from "vitest"
import type { ServiceEndpoint } from "./discovery.js"
import { createForwardHandler, type ForwardConnectionReporter, type ForwardDeps } from "./forward.js"
import { createLogger, type LogFields, type LogLevel, type LogSink } from "./logging.js"

const SERVER = serverId("server-1")
const PASSWORD = "s3cr3t-password"
const AUTHORIZATION = `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`

const cleanups: Array<() => void | Promise<void>> = []

function onCleanup(cleanup: () => void | Promise<void>): void {
  cleanups.push(cleanup)
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// ---------------------------------------------------------------------------------------------
// A real local HTTP server, no engine. It records every request so tests can prove what was and
// was not forwarded, and it answers with whatever the test configures.
// ---------------------------------------------------------------------------------------------

interface Recorded {
  readonly method: string | undefined
  readonly url: URL
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

type Responder = (request: Recorded, response: ServerResponse) => void

interface Fixture {
  readonly endpoint: ServiceEndpoint
  readonly requests: Recorded[]
  setResponder(responder: Responder): void
  close(): Promise<void>
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })
}

async function createFixture(): Promise<Fixture> {
  const requests: Recorded[] = []
  let responder: Responder = (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.end("{}")
  }
  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      const recorded: Recorded = {
        method: request.method,
        url: new URL(request.url ?? "/", "http://127.0.0.1"),
        headers: request.headers,
        body,
      }
      requests.push(recorded)
      responder(recorded, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  const close = (): Promise<void> =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      // A second call after the server is already closed reports an error; the promise still settles.
      server.close(() => resolve())
    })
  onCleanup(close)
  return {
    endpoint: { url: `http://127.0.0.1:${port}`, auth: { type: "basic", username: "opencode", password: PASSWORD } },
    requests,
    setResponder: (next) => {
      responder = next
    },
    close,
  }
}

// ---------------------------------------------------------------------------------------------
// Harness: the forward handler with a capturing logger and a recording connection reporter.
// ---------------------------------------------------------------------------------------------

interface LogLine {
  readonly level: LogLevel
  readonly message: string
  readonly fields: LogFields
}

interface Harness {
  readonly handler: ReturnType<typeof createForwardHandler>
  readonly lines: LogLine[]
  readonly reporter: { unauthorized: number }
}

function createHarness(endpoint: () => ServiceEndpoint | undefined, options?: Pick<ForwardDeps, "timeoutMs">): Harness {
  const lines: LogLine[] = []
  const sink: LogSink = { write: (level, message, fields) => lines.push({ level, message, fields }) }
  const reporter = { unauthorized: 0 }
  const connection: ForwardConnectionReporter = {
    onUnauthorized: () => {
      reporter.unauthorized += 1
    },
  }
  const handler = createForwardHandler({
    fetch: globalThis.fetch,
    logger: createLogger(sink),
    endpoint,
    connection,
    timeoutMs: options?.timeoutMs,
  })
  return { handler, lines, reporter }
}

function input(overrides: Partial<MethodInput<"engine.fetch">> = {}): MethodInput<"engine.fetch"> {
  return { serverId: SERVER, method: "GET", path: "/api/session", body: null, ...overrides }
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe("request forwarding", () => {
  it("AC-008 / BR-019 / BR-021 / AC-1: forwards an allowlisted request with Basic auth and round-trips it", async () => {
    const fixture = await createFixture()
    const harness = createHarness(() => fixture.endpoint)
    fixture.setResponder((_request, response) => {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-test": "yes" })
      response.end('{"hello":"world"}')
    })

    const response = await harness.handler(
      input({ path: "/api/session", query: { directory: "/tmp", id: ["a", "b"] } }),
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ kind: "text", text: '{"hello":"world"}' })
    expect(response.headers["x-test"]).toBe("yes")

    expect(fixture.requests).toHaveLength(1)
    const recorded = fixture.requests[0]
    expect(recorded?.method).toBe("GET")
    expect(recorded?.url.pathname).toBe("/api/session")
    expect(recorded?.url.searchParams.get("directory")).toBe("/tmp")
    expect(recorded?.url.searchParams.getAll("id")).toEqual(["a", "b"])
    // BR-021: username `opencode`, the current password.
    expect(recorded?.headers.authorization).toBe(AUTHORIZATION)
  })

  it("BR-022 / AC-008 / AC-4 / CASE-012: a binary response arrives as base64 and round-trips", async () => {
    const fixture = await createFixture()
    const harness = createHarness(() => fixture.endpoint)
    const bytes = Buffer.from([0, 1, 2, 253, 254, 255])
    fixture.setResponder((_request, response) => {
      response.writeHead(200, { "content-type": "application/octet-stream" })
      response.end(bytes)
    })

    const response = await harness.handler(input({ path: "/api/file" }))
    expect(response.body?.kind).toBe("base64")
    const body = response.body
    if (body?.kind !== "base64") throw new Error("expected a base64 body")
    expect(body.data).toBe(bytes.toString("base64"))
    expect(Buffer.from(body.data, "base64")).toEqual(bytes)
  })

  it("BR-022 / AC-008: text and base64 request bodies reach the engine and text responses round-trip", async () => {
    const fixture = await createFixture()
    const harness = createHarness(() => fixture.endpoint)
    fixture.setResponder((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" })
      response.end("plain")
    })

    const text = await harness.handler(
      input({ method: "POST", path: "/api/session", body: { kind: "text", text: "hello" } }),
    )
    expect(text.body).toEqual({ kind: "text", text: "plain" })
    expect(fixture.requests[0]?.body.toString("utf8")).toBe("hello")

    await harness.handler(
      input({
        method: "PUT",
        path: "/api/session",
        body: { kind: "base64", data: Buffer.from([1, 2, 3]).toString("base64") },
      }),
    )
    expect(fixture.requests[1]?.body).toEqual(Buffer.from([1, 2, 3]))
  })

  it("BR-023 / SEC-004 / AC-5: set-cookie never reaches the caller", async () => {
    const fixture = await createFixture()
    const harness = createHarness(() => fixture.endpoint)
    fixture.setResponder((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": ["session=secret-cookie; HttpOnly", "other=2"],
        "x-test": "yes",
      })
      response.end("{}")
    })

    const response = await harness.handler(input({}))
    expect(response.headers["x-test"]).toBe("yes")
    expect(Object.keys(response.headers)).not.toContain("set-cookie")
    expect(JSON.stringify(response)).not.toContain("secret-cookie")
  })

  it("BR-019 / SEC-003 / AC-009 / CASE-011: .. , absolute URLs and /auth/ paths are rejected without forwarding", async () => {
    const fixture = await createFixture()
    const harness = createHarness(() => fixture.endpoint)
    const paths = [
      "/api/../secret",
      "/api/%2e%2e/auth/connect/x",
      "/openapi.json/../../x",
      "http://evil.example/api/x",
      "//evil.example/api/x",
      "/auth/connect/abc",
    ]
    for (const path of paths) {
      await expect(harness.handler(input({ path }))).rejects.toMatchObject({ code: "forbidden_path" })
    }
    expect(fixture.requests).toHaveLength(0)
  })

  it("BR-020 / SEC-003 / AC-009 / AC-2: authorization, cookie and proxy-authorization are rejected case-insensitively", async () => {
    const fixture = await createFixture()
    const harness = createHarness(() => fixture.endpoint)
    for (const name of ["authorization", "Cookie", "Proxy-Authorization", "AUTHORIZATION", "prOxY-aUtHoRiZaTiOn"]) {
      await expect(harness.handler(input({ headers: { [name]: "x" } }))).rejects.toMatchObject({
        code: "forbidden_path",
      })
    }
    expect(fixture.requests).toHaveLength(0)
  })

  it("BR-024 / AC-009 / AC-3: an unreachable engine is engine_unreachable and a silent one is timeout", async () => {
    const closedFixture = await createFixture()
    const { port } = new URL(closedFixture.endpoint.url)
    await closedFixture.close()
    const unreachable = createHarness(() => ({ url: `http://127.0.0.1:${port}` }))
    await expect(unreachable.handler(input({ path: "/api/session" }))).rejects.toMatchObject({
      code: "engine_unreachable",
    })

    const silent = await createFixture()
    silent.setResponder(() => undefined)
    const slow = createHarness(() => silent.endpoint, { timeoutMs: 25 })
    await expect(slow.handler(input({ path: "/api/session" }))).rejects.toMatchObject({ code: "timeout" })
  })

  it("BR-025 / AC-6: a 401 notifies the connection machine to re-read credentials", async () => {
    const fixture = await createFixture()
    const harness = createHarness(() => fixture.endpoint)
    fixture.setResponder((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" })
      response.end('{"error":"unauthorized"}')
    })

    const response = await harness.handler(input({ path: "/api/session" }))
    expect(response.status).toBe(401)
    expect(response.body).toEqual({ kind: "text", text: '{"error":"unauthorized"}' })
    expect(harness.reporter.unauthorized).toBe(1)
  })

  it("BR-026 / §16: a non-idempotent request is forwarded at most once", async () => {
    const fixture = await createFixture()
    const harness = createHarness(() => fixture.endpoint)
    fixture.setResponder((_request, response) => {
      response.destroy()
    })

    await expect(
      harness.handler(input({ method: "POST", path: "/api/session", body: { kind: "text", text: "x" } })),
    ).rejects.toMatchObject({ code: "engine_unreachable" })
    expect(fixture.requests).toHaveLength(1)
  })

  it("SEC-002 / SEC-003 / AC-7: the capturing logger never sees a password, auth header or body content", async () => {
    const fixture = await createFixture()
    const harness = createHarness(() => fixture.endpoint)
    fixture.setResponder((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" })
      response.end("response-secret-content")
    })

    await harness.handler(
      input({ method: "POST", path: "/api/session", body: { kind: "text", text: "request-secret-content" } }),
    )
    await expect(harness.handler(input({ path: "/auth/connect/x" }))).rejects.toMatchObject({ code: "forbidden_path" })
    await expect(harness.handler(input({ headers: { authorization: "Bearer leak" } }))).rejects.toMatchObject({
      code: "forbidden_path",
    })
    const unreachable = createHarness(() => ({ url: "http://127.0.0.1:1" }))
    await expect(unreachable.handler(input({ path: "/api/session" }))).rejects.toMatchObject({
      code: "engine_unreachable",
    })

    const logged = JSON.stringify([...harness.lines, ...unreachable.lines])
    expect(logged).not.toContain(PASSWORD)
    expect(logged).not.toContain(AUTHORIZATION)
    expect(logged).not.toContain("opencode:")
    expect(logged).not.toContain("request-secret-content")
    expect(logged).not.toContain("response-secret-content")
    expect(logged).not.toContain("Bearer leak")
    // The rejections are still observable, without any secret.
    expect(harness.lines.some((line) => line.fields.code === "forbidden_path")).toBe(true)
    expect(unreachable.lines.some((line) => line.fields.code === "engine_unreachable")).toBe(true)
  })
})
