import { type EngineCapabilities, serverId } from "@mortise/domain"
import { describe, expect, it } from "vitest"
import type { CapabilityCache } from "./capabilities.js"
import { type Clock, type Connection, createConnection } from "./connection.js"
import type { Discovery, DiscoveryOutcome, ServiceEndpoint } from "./discovery.js"
import { createLogger, type LogFields, type Logger, type LogLevel, type LogSink } from "./logging.js"
import type { ProbeResult } from "./probe.js"

const SERVER = serverId("server-1")

const ENDPOINT: ServiceEndpoint = {
  url: "http://127.0.0.1:49374",
  auth: { type: "basic", username: "opencode", password: "s3cr3t-password" },
}

const ROTATED: ServiceEndpoint = {
  url: "http://127.0.0.1:49374",
  auth: { type: "basic", username: "opencode", password: "rotated-password" },
}

const CAPABILITIES: EngineCapabilities = {
  pairing: true,
  persistentTerminals: true,
  forkBeforeMessage: true,
  experimental: new Set(["experimental.config.update"]),
}

const ok = (version: string): ProbeResult => ({
  kind: "ok",
  info: { version, pid: 42, capabilities: { persistentPty: true } },
})

interface LogLine {
  readonly level: LogLevel
  readonly message: string
  readonly fields: LogFields
}

interface FakeClock {
  readonly clock: Clock
  runAll(): void
  pending(): number
}

function createFakeClock(): FakeClock {
  let next = 0
  const timers = new Map<number, () => void>()
  return {
    clock: {
      setTimeout: (handler) => {
        const id = ++next
        timers.set(id, handler)
        return id
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number)
      },
    },
    runAll() {
      for (const [id, handler] of [...timers]) {
        timers.delete(id)
        handler()
      }
    },
    pending: () => timers.size,
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

interface HarnessOptions {
  readonly outcome: DiscoveryOutcome
  readonly probe: ProbeResult | ProbeResult[]
  readonly capabilities?: EngineCapabilities
  readonly findOrStartError?: Error
}

interface Harness {
  readonly connection: Connection
  readonly logger: Logger
  readonly states: string[]
  readonly lines: LogLine[]
  readonly clock: FakeClock
  setOutcome(outcome: DiscoveryOutcome): void
  setRediscover(endpoint: ServiceEndpoint | undefined): void
  setProbe(result: ProbeResult): void
  setFindOrStartError(error: Error | undefined): void
  findOrStartCalls(): number
  probeCalls(): number
}

function createHarness(options: HarnessOptions): Harness {
  const states: string[] = []
  const clock = createFakeClock()
  const lines: LogLine[] = []
  const sink: LogSink = { write: (level, message, fields) => lines.push({ level, message, fields }) }
  const logger = createLogger(sink)

  let outcome = options.outcome
  let findOrStartError = options.findOrStartError
  let rediscover: ServiceEndpoint | undefined =
    options.outcome.kind === "found" || options.outcome.kind === "started" ? options.outcome.endpoint : undefined
  let probes: ProbeResult[] = Array.isArray(options.probe) ? [...options.probe] : [options.probe]
  let findOrStartCount = 0
  let probeCount = 0

  const discovery: Discovery = {
    discover: async () => rediscover,
    async findOrStart(handler) {
      findOrStartCount += 1
      if (findOrStartError !== undefined) throw findOrStartError
      if (outcome.kind === "started") handler?.onStarting?.()
      return outcome
    },
  }

  const capabilities: CapabilityCache = { forVersion: async () => options.capabilities ?? CAPABILITIES }

  const connection = createConnection({
    serverId: SERVER,
    discovery,
    probe: async () => {
      probeCount += 1
      const result = probes.length > 1 ? probes.shift() : probes[0]
      return result as ProbeResult
    },
    capabilities,
    logger,
    clock: clock.clock,
  })
  connection.subscribe((state) => states.push(state.phase))

  return {
    connection,
    logger,
    states,
    lines,
    clock,
    setOutcome: (next) => {
      outcome = next
    },
    setRediscover: (endpoint) => {
      rediscover = endpoint
    },
    setProbe: (result) => {
      probes = [result]
    },
    setFindOrStartError: (error) => {
      findOrStartError = error
    },
    findOrStartCalls: () => findOrStartCount,
    probeCalls: () => probeCount,
  }
}

describe("connection state machine", () => {
  it("AC-1 / BR-001 / AC-001: adopts a ready registration and reaches connecting without starting", async () => {
    const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: ok("2.0.26") })
    expect(harness.connection.get()).toEqual({ phase: "discovering" })
    await harness.connection.start()
    expect(harness.connection.get()).toEqual({ phase: "connecting", url: ENDPOINT.url })
    expect(harness.states).toEqual(["discovering", "connecting"])
    expect(harness.probeCalls()).toBe(1)
  })

  it("BR-003: an adopted service is never restarted or replaced", async () => {
    const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: ok("2.0.26") })
    await harness.connection.start()
    expect(harness.states).not.toContain("starting")
    expect(harness.findOrStartCalls()).toBe(1)
    expect(harness.probeCalls()).toBe(1)
  })

  it("AC-1 / BR-004 / AC-003: the start path emits discovering, starting, connecting", async () => {
    const harness = createHarness({ outcome: { kind: "started", endpoint: ENDPOINT }, probe: ok("2.0.26") })
    await harness.connection.start()
    expect(harness.states).toEqual(["discovering", "starting", "connecting"])
  })

  it("AC-1: a failed start reaches failed and retry returns to discovering", async () => {
    const harness = createHarness({
      outcome: { kind: "started", endpoint: ENDPOINT },
      probe: ok("2.0.26"),
      findOrStartError: new Error("spawn failed"),
    })
    await harness.connection.start()
    expect(harness.connection.get().phase).toBe("failed")

    harness.setFindOrStartError(undefined)
    harness.setOutcome({ kind: "found", endpoint: ENDPOINT })
    await harness.connection.retry()
    expect(harness.connection.get()).toEqual({ phase: "connecting", url: ENDPOINT.url })
    expect(harness.states).toContain("discovering")
  })

  it("AC-1 / BR-005 / CASE-010: no CLI yields no-engine and a 30 s recheck", async () => {
    const harness = createHarness({ outcome: { kind: "no-engine", reason: "no-cli" }, probe: ok("2.0.26") })
    await harness.connection.start()
    expect(harness.connection.get()).toEqual({ phase: "no-engine" })
    expect(harness.clock.pending()).toBe(1)

    harness.setOutcome({ kind: "found", endpoint: ENDPOINT })
    harness.setRediscover(ENDPOINT)
    harness.clock.runAll()
    await flush()
    expect(harness.connection.get()).toEqual({ phase: "connecting", url: ENDPOINT.url })
  })

  it("AC-1 / BR-005: recheck() re-runs discovery only while no-engine", async () => {
    const harness = createHarness({ outcome: { kind: "no-engine", reason: "start-disabled" }, probe: ok("2.0.26") })
    await harness.connection.start()
    const before = harness.findOrStartCalls()
    harness.setOutcome({ kind: "found", endpoint: ENDPOINT })
    harness.setRediscover(ENDPOINT)
    await harness.connection.recheck()
    expect(harness.findOrStartCalls()).toBe(before + 1)
    expect(harness.connection.get()).toEqual({ phase: "connecting", url: ENDPOINT.url })

    await harness.connection.recheck()
    expect(harness.connection.get().phase).toBe("connecting")
  })

  it("AC-1 / BR-008: a 404 on /api/info is incompatible (info-missing)", async () => {
    const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: { kind: "info-missing" } })
    await harness.connection.start()
    expect(harness.connection.get()).toEqual({
      phase: "incompatible",
      reason: "info-missing",
      supportedRange: ">=2.0.20 <2.1.0",
    })
  })

  it("AC-1 / BR-007 / CASE-008 / CASE-009: a version outside the range is incompatible and not replaced", async () => {
    for (const version of ["2.0.19", "2.1.0"]) {
      const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: ok(version) })
      await harness.connection.start()
      expect(harness.connection.get()).toEqual({
        phase: "incompatible",
        reason: "version-out-of-range",
        engineVersion: version,
        supportedRange: ">=2.0.20 <2.1.0",
      })
      expect(harness.findOrStartCalls()).toBe(1)
      expect(harness.states).not.toContain("starting")
    }
  })

  it("AC-1: incompatible returns to discovering on retry", async () => {
    const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: ok("2.0.19") })
    await harness.connection.start()
    expect(harness.connection.get().phase).toBe("incompatible")
    harness.setProbe(ok("2.0.26"))
    await harness.connection.retry()
    expect(harness.connection.get()).toEqual({ phase: "connecting", url: ENDPOINT.url })
  })

  it("AC-1 / AC-004 / CASE-007: a 401 goes to unauthorized and recovers when the password rotated", async () => {
    const harness = createHarness({
      outcome: { kind: "found", endpoint: ENDPOINT },
      probe: [{ kind: "unauthorized" }, ok("2.0.26")],
    })
    harness.setRediscover(ROTATED)
    await harness.connection.start()
    await flush()
    expect(harness.states).toEqual(["discovering", "unauthorized", "connecting"])
    expect(harness.connection.get()).toEqual({ phase: "connecting", url: ENDPOINT.url })
  })

  it("AC-1 / AC-004: an unchanged password leaves the machine in unauthorized", async () => {
    const harness = createHarness({
      outcome: { kind: "found", endpoint: ENDPOINT },
      probe: [{ kind: "unauthorized" }, { kind: "unauthorized" }],
    })
    harness.setRediscover(ENDPOINT)
    await harness.connection.start()
    await flush()
    expect(harness.connection.get().phase).toBe("unauthorized")
  })

  it("AC-1 / Q-001: server.connected moves connecting to live and never emits hydrating", async () => {
    const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: ok("2.0.26") })
    await harness.connection.start()
    harness.connection.onStreamConnected()
    expect(harness.connection.get()).toEqual({
      phase: "live",
      info: { version: "2.0.26", capabilities: CAPABILITIES, support: "supported" },
    })
    expect(harness.states).not.toContain("hydrating")
  })

  it("AC-1: a newer 2.0.x joins as untested (alternate journey)", async () => {
    const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: ok("2.0.27") })
    await harness.connection.start()
    harness.connection.onStreamConnected()
    expect(harness.connection.get().phase).toBe("live")
    const state = harness.connection.get()
    if (state.phase !== "live") throw new Error("expected live")
    expect(state.info.support).toBe("untested")
  })

  it("AC-1: stream loss moves live to resyncing and a reconnect returns to live", async () => {
    const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: ok("2.0.26") })
    await harness.connection.start()
    harness.connection.onStreamConnected()
    harness.connection.onStreamLost("overflow")
    const state = harness.connection.get()
    expect(state.phase).toBe("resyncing")
    if (state.phase !== "resyncing") throw new Error("expected resyncing")
    expect(state.reason).toBe("overflow")
    harness.connection.onStreamConnected()
    expect(harness.connection.get().phase).toBe("live")
  })

  it("AC-1 / BR-010 / CASE-006: a replaced registration returns to discovering and rejoins", async () => {
    const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: ok("2.0.26") })
    await harness.connection.start()
    harness.connection.onStreamConnected()
    harness.connection.onStreamLost("ended")
    harness.setOutcome({ kind: "found", endpoint: ROTATED })
    harness.setRediscover(ROTATED)
    await harness.connection.onRegistrationReplaced()
    expect(harness.states).toContain("discovering")
    expect(harness.connection.get()).toEqual({ phase: "connecting", url: ROTATED.url })
  })

  it("SEC-002 / AC-005: no log line carries the password, even a direct redacted call", async () => {
    const harness = createHarness({ outcome: { kind: "found", endpoint: ENDPOINT }, probe: ok("2.0.26") })
    await harness.connection.start()
    harness.connection.onStreamConnected()
    harness.connection.onStreamLost("overflow")
    harness.connection.onUnauthorized()
    await flush()
    expect(JSON.stringify(harness.lines)).not.toContain("s3cr3t-password")

    harness.lines.length = 0
    harness.logger.info("direct", { password: "s3cr3t-password", nested: { token: "pairing-token", keep: "ok" } })
    expect(JSON.stringify(harness.lines)).not.toContain("s3cr3t-password")
    expect(JSON.stringify(harness.lines)).not.toContain("pairing-token")
    expect(JSON.stringify(harness.lines)).toContain("ok")
  })
})
