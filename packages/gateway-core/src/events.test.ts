import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { serverId } from "@mortise/domain"
import { afterEach, describe, expect, it } from "vitest"
import type { Clock, StreamLossReason } from "./connection.js"
import type { ServiceEndpoint } from "./discovery.js"
import {
  createEventStream,
  type EngineStreamEvent,
  type EventStream,
  type EventStreamDeps,
  type StreamConnectionReporter,
} from "./events.js"
import { createLogger, type LogFields, type LogLevel, type LogSink } from "./logging.js"

const SERVER = serverId("server-1")

const CONNECTED = { id: "evt_1", type: "server.connected", data: {} }

const cleanups: Array<() => void | Promise<void>> = []

function onCleanup(cleanup: () => void | Promise<void>): void {
  cleanups.push(cleanup)
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// ---------------------------------------------------------------------------------------------
// Fixtures: a real local HTTP server, no engine. Tests drive one connection at a time.
// ---------------------------------------------------------------------------------------------

interface SseConnection {
  readonly index: number
  /** Writes one `data:` frame for a JSON-serializable event. */
  send(event: unknown): void
  /** Writes a raw `data:` line, for malformed-payload cases. */
  raw(data: string): void
  /** Writes an SSE heartbeat comment: it carries no bytes a parser keeps, but resets the watchdog. */
  comment(): void
  /** Ends the response, as the engine does when it fails or drops a subscriber. */
  end(): void
}

interface SseFixture {
  readonly endpoint: ServiceEndpoint
  requestCount(): number
  closedCount(): number
  /** Resolves with the Nth (0-based) `/api/event` connection, waiting for it if needed. */
  connection(index: number): Promise<SseConnection>
  close(): Promise<void>
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

function trackClose(response: ServerResponse, onClose: () => void): void {
  response.on("close", onClose)
}

async function createSseFixture(): Promise<SseFixture> {
  const connections = new Map<number, SseConnection>()
  const waiters: Array<{ readonly index: number; readonly resolve: (connection: SseConnection) => void }> = []
  let requestCount = 0
  let closedCount = 0

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url === undefined ? "" : new URL(request.url, "http://localhost").pathname
    if (path !== "/api/event") {
      response.writeHead(404)
      response.end()
      return
    }
    const index = requestCount
    requestCount += 1
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" })
    const connection: SseConnection = {
      index,
      send: (event) => response.write(`data: ${JSON.stringify(event)}\n\n`),
      raw: (data) => response.write(`data: ${data}\n\n`),
      comment: () => response.write(": heartbeat\n\n"),
      end: () => response.end(),
    }
    trackClose(response, () => {
      closedCount += 1
    })
    connections.set(index, connection)
    for (const waiter of [...waiters]) {
      if (waiter.index !== index) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(connection)
    }
  })
  const url = await listen(server)
  onCleanup(
    () =>
      new Promise<void>((resolve, reject) => {
        for (const connection of connections.values()) connection.end()
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  )

  return {
    endpoint: { url },
    requestCount: () => requestCount,
    closedCount: () => closedCount,
    connection(index) {
      const existing = connections.get(index)
      if (existing !== undefined) return Promise.resolve(existing)
      return new Promise((resolve) => {
        waiters.push({ index, resolve })
      })
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const connection of connections.values()) connection.end()
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}

/** A server that always answers the same status, for the 401 path. */
async function createStatusFixture(status: number): Promise<{ endpoint: ServiceEndpoint; requestCount: () => number }> {
  let requestCount = 0
  const server = createServer((_request, response) => {
    requestCount += 1
    response.writeHead(status)
    response.end()
  })
  const url = await listen(server)
  onCleanup(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  )
  return { endpoint: { url }, requestCount: () => requestCount }
}

// ---------------------------------------------------------------------------------------------
// A fake clock, so the watchdog, batching window and backoff are all test-controlled.
// ---------------------------------------------------------------------------------------------

interface FakeClock {
  readonly clock: Clock
  advance(milliseconds: number): void
  pendingDelays(): number[]
}

function createFakeClock(): FakeClock {
  let now = 0
  let next = 0
  const timers = new Map<number, { readonly due: number; readonly delay: number; readonly handler: () => void }>()
  return {
    clock: {
      setTimeout: (handler, milliseconds) => {
        const id = ++next
        timers.set(id, { due: now + milliseconds, delay: milliseconds, handler })
        return id
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number)
      },
    },
    advance(milliseconds) {
      const target = now + milliseconds
      for (;;) {
        let chosenId: number | undefined
        let chosenDue = Number.POSITIVE_INFINITY
        for (const [id, timer] of timers) {
          if (timer.due > target || timer.due >= chosenDue) continue
          chosenId = id
          chosenDue = timer.due
        }
        if (chosenId === undefined) break
        const chosen = timers.get(chosenId)
        timers.delete(chosenId)
        if (chosen === undefined) continue
        now = chosen.due
        chosen.handler()
      }
      now = target
    },
    pendingDelays: () => [...timers.values()].map((timer) => timer.delay).sort((left, right) => left - right),
  }
}

const realDelay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await realDelay(5)
  }
}

// ---------------------------------------------------------------------------------------------
// Harness: stream + reporter + clock + captured messages and log lines.
// ---------------------------------------------------------------------------------------------

interface Reporter {
  connected: number
  readonly losses: StreamLossReason[]
  unauthorized: number
}

interface LogLine {
  readonly level: LogLevel
  readonly message: string
  readonly fields: LogFields
}

interface Harness {
  readonly stream: EventStream
  readonly reporter: Reporter
  readonly clock: FakeClock
  readonly lines: LogLine[]
}

function createHarness(
  options?: Pick<EventStreamDeps, "batchIntervalMs" | "connectTimeoutMs" | "idleTimeoutMs" | "backoffMs">,
): Harness {
  const reporter: Reporter = { connected: 0, losses: [], unauthorized: 0 }
  const connection: StreamConnectionReporter = {
    onStreamConnected: () => {
      reporter.connected += 1
    },
    onStreamLost: (reason) => {
      reporter.losses.push(reason)
    },
    onUnauthorized: () => {
      reporter.unauthorized += 1
    },
  }
  const clock = createFakeClock()
  const lines: LogLine[] = []
  const sink: LogSink = { write: (level, message, fields) => lines.push({ level, message, fields }) }
  const stream = createEventStream({
    serverId: SERVER,
    fetch: globalThis.fetch,
    logger: createLogger(sink),
    clock: clock.clock,
    connection,
    batchIntervalMs: options?.batchIntervalMs,
    connectTimeoutMs: options?.connectTimeoutMs,
    idleTimeoutMs: options?.idleTimeoutMs,
    backoffMs: options?.backoffMs,
  })
  onCleanup(() => stream.dispose())
  return { stream, reporter, clock, lines }
}

function collect(stream: EventStream): { readonly messages: EngineStreamEvent[]; readonly unsubscribe: () => void } {
  const messages: EngineStreamEvent[] = []
  const unsubscribe = stream.subscribe((event) => messages.push(event))
  return { messages, unsubscribe }
}

function batches(messages: readonly EngineStreamEvent[]): Array<Extract<EngineStreamEvent, { type: "engine.events" }>> {
  return messages.filter(
    (message): message is Extract<EngineStreamEvent, { type: "engine.events" }> => message.type === "engine.events",
  )
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe("event stream", () => {
  it("BR-016 / AC-006 / AC-1: delivers events in order as one batch on the configured interval", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness()
    const { messages } = collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "server.connected")

    connection.send({ id: "evt_2", type: "session.updated", data: { n: 1 } })
    connection.send({ id: "evt_3", type: "session.updated", data: { n: 2 } })
    // The batch timer is armed once both events are buffered; nothing is emitted before it fires.
    await waitFor(() => harness.clock.pendingDelays().includes(16), "batch window")
    expect(messages).toEqual([])

    harness.clock.advance(16)
    await waitFor(() => batches(messages).length === 1, "one batch")
    const batch = batches(messages)[0]
    expect(batch?.generation).toBe(1)
    expect(batch?.events.map((event) => (event as { readonly data: { readonly n: number } }).data.n)).toEqual([1, 2])
    // The first generation is announced by connection.changed, not a resync.
    expect(messages.some((message) => message.type === "engine.resync")).toBe(false)
  })

  it("BR-017 / AC-006 / CASE-005: malformed JSON is skipped and the stream keeps going", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness()
    const { messages } = collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "server.connected")

    connection.raw("{ not valid json")
    connection.send({ id: "evt_2", type: "session.updated", data: { n: 1 } })
    await waitFor(() => harness.clock.pendingDelays().includes(16), "batch window")
    harness.clock.advance(16)
    await waitFor(() => batches(messages).length === 1, "one batch")

    expect(batches(messages)[0]?.events).toHaveLength(1)
    expect(harness.reporter.losses).toEqual([])
    expect(fixture.requestCount()).toBe(1)
    const warning = harness.lines.find((line) => line.level === "warn")
    expect(warning?.message).toContain("malformed event")
    // SEC-002: the skipped payload never appears in a log line.
    expect(JSON.stringify(harness.lines)).not.toContain("not valid json")
  })

  it("BR-012 / AC-5 / CASE-003: a first event other than server.connected reconnects and logs an error", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness()
    const { messages } = collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send({ id: "evt_1", type: "session.updated", data: {} })

    await waitFor(() => harness.lines.some((line) => line.level === "error"), "error log")
    await waitFor(() => harness.clock.pendingDelays().includes(1000), "backoff")
    // It never reached server.connected, so there is no generation and no loss to report.
    expect(harness.reporter.connected).toBe(0)
    expect(harness.reporter.losses).toEqual([])
    expect(messages).toEqual([])

    harness.clock.advance(1000)
    await waitFor(() => fixture.requestCount() === 2, "reconnect")
    const second = await fixture.connection(1)
    second.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "reconnected")
    expect(harness.lines.some((line) => line.message.includes("server.connected"))).toBe(true)
  })

  it("BR-013 / AC-006 / CASE-001: a heartbeat keeps a quiet stream alive past 45 s", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness()
    collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "server.connected")

    harness.clock.advance(44_000)
    expect(harness.reporter.losses).toEqual([])
    connection.comment()
    // Let the comment arrive and reset the watchdog before advancing again.
    await realDelay(20)
    harness.clock.advance(44_000)

    expect(harness.reporter.losses).toEqual([])
    expect(fixture.requestCount()).toBe(1)
  })

  it("BR-013 / AC-005 / CASE-002: 45 s of silence stalls and reconnects with a resync", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness()
    const { messages } = collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "server.connected")

    harness.clock.advance(45_000)
    await waitFor(() => harness.reporter.losses.length === 1, "stall")
    expect(harness.reporter.losses[0]).toBe("stalled")

    harness.clock.advance(1000)
    await waitFor(() => fixture.requestCount() === 2, "reconnect")
    const second = await fixture.connection(1)
    second.send(CONNECTED)
    await waitFor(() => messages.some((message) => message.type === "engine.resync"), "resync")

    const resync = messages.find((message) => message.type === "engine.resync")
    expect(resync).toEqual({ type: "engine.resync", serverId: SERVER, generation: 2, reason: "gap" })
    expect(harness.stream.generation()).toBe(2)
  })

  it("OPS-005: a stream that never starts reconnects after the 2 s connect timeout", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness()
    collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    await fixture.connection(0)
    harness.clock.advance(2000)
    await waitFor(() => harness.clock.pendingDelays().includes(1000), "backoff after connect timeout")

    expect(harness.reporter.connected).toBe(0)
    harness.clock.advance(1000)
    await waitFor(() => fixture.requestCount() === 2, "reconnect")
  })

  it("BR-014 / CASE-014: repeated instant failures back off 1, 2, 5, 10 s and stay capped", async () => {
    const fixture = await createSseFixture()
    // A connect timeout distinct from every backoff step, so a pending backoff is never confused
    // with a pending connect timer.
    const harness = createHarness({ connectTimeoutMs: 3000 })
    collect(harness.stream)
    harness.stream.start(fixture.endpoint)

    const expected = [1000, 2000, 5000, 10_000, 10_000]
    for (const [step, delay] of expected.entries()) {
      const connection = await fixture.connection(step)
      connection.end()
      await waitFor(() => harness.clock.pendingDelays().includes(delay), `backoff ${delay}`)
      expect(harness.clock.pendingDelays()).toEqual([delay])
      harness.clock.advance(delay)
      await waitFor(() => fixture.requestCount() === step + 2, `reconnect ${step}`)
    }
  })

  it("BR-015 / AC-005 / CASE-004: a server-closed stream reconnects and resyncs", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness({ batchIntervalMs: 1 })
    const { messages } = collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "server.connected")
    connection.send({ id: "evt_2", type: "session.updated", data: { n: 1 } })
    await waitFor(() => harness.clock.pendingDelays().includes(1), "batch window")
    harness.clock.advance(1)
    await waitFor(() => batches(messages).length === 1, "gen 1 batch")

    // The engine fails the subscriber when its queue overflows; the client sees a close.
    connection.end()
    await waitFor(() => harness.reporter.losses.length === 1, "close")
    expect(harness.reporter.losses[0]).toBe("overflow")

    harness.clock.advance(1000)
    await waitFor(() => fixture.requestCount() === 2, "reconnect")
    const second = await fixture.connection(1)
    second.send(CONNECTED)
    await waitFor(() => messages.some((message) => message.type === "engine.resync"), "resync")

    const resync = messages.find((message) => message.type === "engine.resync")
    expect(resync).toEqual({ type: "engine.resync", serverId: SERVER, generation: 2, reason: "overflow" })
  })

  it("BR-015 / AC-005: a batch buffered for generation N never arrives after the N+1 resync", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness({ batchIntervalMs: 10_000, backoffMs: [10] })
    const { messages } = collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "server.connected")

    connection.send({ id: "evt_2", type: "session.updated", data: { n: 1 } })
    // The generation-1 event is buffered and its batch timer is armed; it has not been delivered.
    await waitFor(() => harness.clock.pendingDelays().includes(10_000), "gen 1 batch window")
    expect(batches(messages)).toEqual([])

    // The stream dies mid-batch. Whatever happens to the buffered batch, it must never land after
    // the resync that opens generation 2.
    connection.end()
    await waitFor(() => batches(messages).length === 1, "gen 1 batch flushed")
    expect(batches(messages)[0]?.generation).toBe(1)

    harness.clock.advance(10)
    await waitFor(() => fixture.requestCount() === 2, "reconnect")
    const second = await fixture.connection(1)
    second.send(CONNECTED)
    await waitFor(() => messages.some((message) => message.type === "engine.resync"), "resync")

    const resyncIndex = messages.findIndex((message) => message.type === "engine.resync" && message.generation === 2)
    expect(resyncIndex).toBeGreaterThan(messages.findIndex((message) => message.type === "engine.events"))
    const staleAfterResync = messages.some(
      (message, index) => message.type === "engine.events" && message.generation === 1 && index > resyncIndex,
    )
    expect(staleAfterResync).toBe(false)
  })

  it("BR-011 / AC-007 / AC-6: two subscribers share exactly one upstream request", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness()
    const first = collect(harness.stream)
    const second = collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "server.connected")
    connection.send({ id: "evt_2", type: "session.updated", data: { n: 1 } })
    await waitFor(() => harness.clock.pendingDelays().includes(16), "batch window")
    harness.clock.advance(16)
    await waitFor(() => first.messages.length === 1 && second.messages.length === 1, "both subscribers")

    expect(fixture.requestCount()).toBe(1)
    expect(first.messages[0]).toEqual(second.messages[0])
  })

  it("BR-011 / AC-007 / CASE-013: the upstream stays open while one subscriber remains and closes with none", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness()
    const first = collect(harness.stream)
    const second = collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "server.connected")

    first.unsubscribe()
    await realDelay(20)
    expect(fixture.requestCount()).toBe(1)
    expect(fixture.closedCount()).toBe(0)

    connection.send({ id: "evt_2", type: "session.updated", data: { n: 1 } })
    await waitFor(() => harness.clock.pendingDelays().includes(16), "batch window")
    harness.clock.advance(16)
    await waitFor(() => second.messages.length === 1, "remaining subscriber")

    second.unsubscribe()
    await waitFor(() => fixture.closedCount() === 1, "closed with none")
    harness.clock.advance(60_000)
    expect(fixture.requestCount()).toBe(1)
  })

  it("BR-011 / AC-007: stop closes the upstream and clears every timer", async () => {
    const fixture = await createSseFixture()
    const harness = createHarness()
    collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    const connection = await fixture.connection(0)
    connection.send(CONNECTED)
    await waitFor(() => harness.reporter.connected === 1, "server.connected")

    harness.stream.stop()
    await waitFor(() => fixture.closedCount() === 1, "closed")
    expect(harness.clock.pendingDelays()).toEqual([])
    harness.clock.advance(60_000)
    expect(fixture.requestCount()).toBe(1)
  })

  it("§16 / BR-011: a 401 on the stream reports unauthorized and does not reconnect", async () => {
    const fixture = await createStatusFixture(401)
    const harness = createHarness()
    collect(harness.stream)

    harness.stream.start(fixture.endpoint)
    await waitFor(() => harness.reporter.unauthorized === 1, "unauthorized")

    expect(harness.reporter.losses).toEqual([])
    harness.clock.advance(60_000)
    expect(fixture.requestCount()).toBe(1)
  })
})
