// The connection state machine (FEAT-001 §10, §BR-003, §BR-005, §BR-007, §BR-010). It owns
// discovery, the start decision, the probe and the support computation, and emits ConnectionState
// changes. The event stream is not part of this file: it reports in through `onStreamConnected`
// and `onStreamLost`, which is how the gateway reaches `live` and `resyncing` without ever
// emitting `hydrating` (FEAT-001 §28, answer to Q-001).

import type { ConnectionState, EngineInfo, ServerId } from "@mortise/domain"
import type { CapabilityCache } from "./capabilities.js"
import type { Discovery, DiscoveryOutcome, ServiceEndpoint } from "./discovery.js"
import type { Logger } from "./logging.js"
import { type ProbeResult, SUPPORTED_RANGE, supportState } from "./probe.js"

/** Why the stream left `live`; identical to `ConnectionState`'s `resyncing.reason`. */
export type StreamLossReason = "ended" | "stalled" | "overflow"

/** How long the gateway waits before rechecking while in `no-engine` (FEAT-001 §28, answer to Q-006). */
export const NO_ENGINE_RECHECK_MS = 30_000

/** Injectable timers, so the recheck and retry delays are testable without real time. */
export interface Clock {
  setTimeout(handler: () => void, milliseconds: number): unknown
  clearTimeout(handle: unknown): void
}

/** The default {@link Clock}, backed by the host's `setTimeout`. */
export function systemClock(): Clock {
  return {
    setTimeout: (handler, milliseconds) => globalThis.setTimeout(handler, milliseconds),
    clearTimeout: (handle) => {
      if (handle !== undefined) globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
    },
  }
}

/** Dependencies of {@link createConnection}. */
export interface ConnectionDeps {
  readonly serverId: ServerId
  readonly discovery: Discovery
  /** Probes `/api/info` for an adopted endpoint. Injected so tests stay offline. */
  readonly probe: (endpoint: ServiceEndpoint) => Promise<ProbeResult>
  readonly capabilities: CapabilityCache
  readonly logger: Logger
  readonly clock: Clock
  /** Milliseconds between `no-engine` rechecks. Defaults to {@link NO_ENGINE_RECHECK_MS}. */
  readonly noEngineRecheckMs?: number
  /**
   * Called when a service is adopted and probes ready, before the `connecting` state is emitted.
   * The gateway stores the endpoint here for the stream and forwarding; it is never exposed
   * through the channel (FEAT-001 §SEC-001).
   */
  readonly onServiceReady?: (endpoint: ServiceEndpoint, info: EngineInfo) => void
}

/**
 * The gateway's connection state machine. Callers start it once, then report stream and credential
 * events; the machine emits every `ConnectionState` change to {@link Connection.subscribe}.
 */
export interface Connection {
  /** The current state. */
  get(): ConnectionState
  /** Begin discovery. Safe to call; a call while one is running is ignored. */
  start(): Promise<void>
  /** Re-run discovery from a terminal-ish state: `failed`, `incompatible` or `no-engine`. */
  retry(): Promise<void>
  /** Recheck while `no-engine`, for window focus and the Retry action (FEAT-001 §Q-006). */
  recheck(): Promise<void>
  /** The stream delivered `server.connected`: `connecting` or `resyncing` becomes `live`. */
  onStreamConnected(): void
  /** The stream ended, stalled or overflowed: `live` becomes `resyncing`. */
  onStreamLost(reason: StreamLossReason): void
  /** A forwarded request or the stream returned `401`: re-read the registration and recover. */
  onUnauthorized(): void
  /** Another client restarted the service: return to `discovering` and recheck (FEAT-001 §BR-010). */
  onRegistrationReplaced(): Promise<void>
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(handler: (state: ConnectionState) => void): () => void
  /** Stop timers and listeners. */
  dispose(): void
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Builds the connection state machine for one server. */
export function createConnection(deps: ConnectionDeps): Connection {
  const noEngineRecheckMs = deps.noEngineRecheckMs ?? NO_ENGINE_RECHECK_MS
  const listeners = new Set<(state: ConnectionState) => void>()
  let state: ConnectionState = { phase: "discovering" }
  let adopted: ServiceEndpoint | undefined
  let info: EngineInfo | undefined
  let recheckTimer: unknown
  let resolving = false
  let disposed = false

  function setState(next: ConnectionState): void {
    if (disposed) return
    const previous = state
    state = next
    if (previous.phase !== next.phase) {
      deps.logger.info("connection state change", {
        serverId: deps.serverId,
        from: previous.phase,
        to: next.phase,
      })
    }
    for (const listener of [...listeners]) listener(next)
  }

  function clearRecheck(): void {
    if (recheckTimer === undefined) return
    deps.clock.clearTimeout(recheckTimer)
    recheckTimer = undefined
  }

  function scheduleRecheck(): void {
    clearRecheck()
    recheckTimer = deps.clock.setTimeout(() => {
      recheckTimer = undefined
      void resolve()
    }, noEngineRecheckMs)
  }

  async function connectTo(endpoint: ServiceEndpoint): Promise<void> {
    const result = await deps.probe(endpoint)
    if (disposed) return
    switch (result.kind) {
      case "unauthorized":
        setState({ phase: "unauthorized", url: endpoint.url })
        void recoverCredentials()
        return
      case "info-missing":
        // A 404 is an incompatible protocol, not an older version (FEAT-001 §BR-008).
        setState({ phase: "incompatible", reason: "info-missing", supportedRange: SUPPORTED_RANGE })
        return
      case "unreachable":
        deps.logger.error("engine probe was unreachable", { serverId: deps.serverId, error: result.message })
        setState({ phase: "failed", message: "The OpenCode service could not be reached" })
        return
      case "error":
        deps.logger.error("engine probe failed", { serverId: deps.serverId, status: result.status })
        setState({ phase: "failed", message: `The OpenCode service returned ${result.status}` })
        return
      case "ok": {
        const support = supportState(result.info.version)
        if (support === "unsupported") {
          // Never replace a service below the floor; show versions and update guidance (§BR-007,
          // §28 answer to Q-003: no restart offer in Phase 0).
          setState({
            phase: "incompatible",
            reason: "version-out-of-range",
            engineVersion: result.info.version,
            supportedRange: SUPPORTED_RANGE,
          })
          return
        }
        const capabilities = await deps.capabilities.forVersion(result.info.version, result.info, endpoint)
        if (disposed) return
        info = { version: result.info.version, capabilities, support }
        setState({ phase: "connecting", url: endpoint.url })
        deps.onServiceReady?.(endpoint, info)
        return
      }
    }
  }

  // Re-read the registration once after a 401 and retry only if the password changed, so a stale
  // registration cannot spin (FEAT-001 §AC-004, §16). Never starts or replaces a service here.
  async function recoverCredentials(): Promise<void> {
    const endpoint = await deps.discovery.discover()
    if (disposed || endpoint === undefined) return
    if (endpoint.auth?.password === adopted?.auth?.password) return
    adopted = endpoint
    await connectTo(endpoint)
  }

  async function resolve(): Promise<void> {
    if (disposed || resolving) return
    resolving = true
    clearRecheck()
    try {
      setState({ phase: "discovering" })
      let outcome: DiscoveryOutcome
      try {
        outcome = await deps.discovery.findOrStart({ onStarting: () => setState({ phase: "starting" }) })
      } catch (cause) {
        deps.logger.error("failed to start the engine", { serverId: deps.serverId, error: errorMessage(cause) })
        setState({ phase: "failed", message: "The OpenCode service failed to start" })
        return
      }
      if (disposed) return
      if (outcome.kind === "no-engine") {
        deps.logger.info("no engine available", { serverId: deps.serverId, reason: outcome.reason })
        setState({ phase: "no-engine" })
        scheduleRecheck()
        return
      }
      adopted = outcome.endpoint
      await connectTo(outcome.endpoint)
    } finally {
      resolving = false
    }
  }

  return {
    get: () => state,
    start: () => resolve(),
    retry: () => resolve(),
    async recheck() {
      if (state.phase !== "no-engine") return
      await resolve()
    },
    onStreamConnected() {
      if (info === undefined) return
      if (state.phase !== "connecting" && state.phase !== "resyncing") return
      setState({ phase: "live", info })
    },
    onStreamLost(reason) {
      if (info === undefined || state.phase !== "live") return
      setState({ phase: "resyncing", info, reason })
    },
    onUnauthorized() {
      if (adopted === undefined) return
      setState({ phase: "unauthorized", url: adopted.url })
      void recoverCredentials()
    },
    async onRegistrationReplaced() {
      deps.logger.info("registration replaced", { serverId: deps.serverId })
      await resolve()
    },
    subscribe(handler) {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
    dispose() {
      disposed = true
      clearRecheck()
      listeners.clear()
    },
  }
}
