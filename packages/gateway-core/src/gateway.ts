// The composition root of the gateway (FEAT-001 §11, §BR-018). Phase 0 owns exactly one shared
// server. This file wires discovery, the probe, capabilities and the connection state machine, and
// keeps the adopted endpoint for the stream (T-005) and forwarding (T-006). It holds no derived
// domain state: every view is rebuilt from fresh reads.

import type { ConnectionState, EngineInfo, ServerId, ServerRef } from "@mortise/domain"
import { type CapabilityCache, createCapabilityCache } from "./capabilities.js"
import { type Clock, type Connection, createConnection, systemClock } from "./connection.js"
import type { Discovery, ServiceEndpoint } from "./discovery.js"
import { createEventStream, type EventStream } from "./events.js"
import type { Logger } from "./logging.js"
import { probeInfo } from "./probe.js"

/** A connection transition for one server, as `connection.changed` carries it (FEAT-001 §12). */
export interface ConnectionChange {
  readonly serverId: ServerId
  readonly state: ConnectionState
}

/**
 * Gateway internals for the event stream (T-005) and forwarding (T-006). Nothing here is reachable
 * through the channel; `endpoint()` carries the password and must stay inside the main process
 * (FEAT-001 §SEC-001).
 */
export interface GatewayInternal {
  /** The raw connection machine, so the stream can report connect, loss and re-auth. */
  readonly connection: Connection
  /** The per-server event stream, so the host can fan its batches out to every window (T-009). */
  readonly events: EventStream
  /** The adopted endpoint, or `undefined` before a service is found. Carries the password. */
  endpoint(): ServiceEndpoint | undefined
  /** The adopted engine's version and capabilities, or `undefined`. */
  info(): EngineInfo | undefined
}

/** Options for {@link createGateway}. */
export interface GatewayOptions {
  readonly serverId: ServerId
  readonly discovery: Discovery
  /** Injected so tests stay offline. */
  readonly fetch: typeof globalThis.fetch
  readonly logger: Logger
  /** Label shown in the server picker. Defaults to `OpenCode`. */
  readonly label?: string
  readonly clock?: Clock
  readonly noEngineRecheckMs?: number
}

/** The gateway the desktop host exposes through a channel. */
export interface Gateway {
  /** Begin discovery of the shared service. */
  start(): Promise<void>
  /** The servers the UI can connect to. Phase 0 always has one shared server. */
  servers(): ServerRef[]
  /** The current connection state of one server. */
  connection(serverId: ServerId): ConnectionState
  /** Subscribe to connection transitions. Returns an unsubscribe function. */
  onConnectionChange(handler: (change: ConnectionChange) => void): () => void
  /** Retry after a failure or an incompatible engine. */
  retry(serverId: ServerId): Promise<void>
  /** Recheck while `no-engine`, for window focus and the Retry action. */
  recheck(serverId: ServerId): Promise<void>
  /** Stop timers and listeners. */
  dispose(): void
  readonly internal: GatewayInternal
}

/**
 * Creates the gateway for one shared server. The caller (`apps/desktop` in T-009) builds the real
 * discovery with {@link openCodeServiceClient}, then exposes this gateway over a channel.
 */
export function createGateway(options: GatewayOptions): Gateway {
  const clock = options.clock ?? systemClock()
  let endpoint: ServiceEndpoint | undefined
  let engineInfo: EngineInfo | undefined
  let url = ""

  const capabilities: CapabilityCache = createCapabilityCache({ fetch: options.fetch })
  // The connection machine and the event stream report to each other; the stream is built first so
  // `onServiceReady` can start it, and the delegate resolves once the machine exists.
  let connection: Connection
  const events: EventStream = createEventStream({
    serverId: options.serverId,
    fetch: options.fetch,
    logger: options.logger,
    clock,
    connection: {
      onStreamConnected: () => connection.onStreamConnected(),
      onStreamLost: (reason) => connection.onStreamLost(reason),
      onUnauthorized: () => connection.onUnauthorized(),
    },
  })
  connection = createConnection({
    serverId: options.serverId,
    discovery: options.discovery,
    probe: (target) => probeInfo({ fetch: options.fetch }, target),
    capabilities,
    logger: options.logger,
    clock,
    noEngineRecheckMs: options.noEngineRecheckMs,
    onServiceReady: (ready, info) => {
      endpoint = ready
      engineInfo = info
      url = ready.url
      events.start(ready)
    },
  })
  // The stream only runs while a service is adopted; a terminal state closes it.
  connection.subscribe((state) => {
    if (state.phase !== "connecting" && state.phase !== "live" && state.phase !== "resyncing") events.stop()
  })

  function requireServer(serverId: ServerId): void {
    if (serverId !== options.serverId) throw new Error(`unknown server ${serverId}`)
  }

  return {
    start: () => connection.start(),
    servers: () => [{ id: options.serverId, label: options.label ?? "OpenCode", kind: "shared", url }],
    connection(serverId) {
      requireServer(serverId)
      return connection.get()
    },
    onConnectionChange: (handler) => connection.subscribe((state) => handler({ serverId: options.serverId, state })),
    async retry(serverId) {
      requireServer(serverId)
      await connection.retry()
    },
    async recheck(serverId) {
      requireServer(serverId)
      await connection.recheck()
    },
    dispose: () => {
      events.dispose()
      connection.dispose()
    },
    internal: {
      connection,
      events,
      endpoint: () => endpoint,
      info: () => engineInfo,
    },
  }
}
