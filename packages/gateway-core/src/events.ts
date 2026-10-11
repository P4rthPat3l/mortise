// The engine event stream (FEAT-001 §BR-011..BR-017, §9, §16). One authenticated `GET /api/event`
// subscription per connected server, shared by every subscriber. It parses SSE frames, keeps an eye
// on the idle watchdog, reconnects with capped backoff, and tags every batch with a generation.
//
// The stream is lossy (C5): the engine never replays, so correctness rests on the resync marker.
// `engine.resync` for generation N+1 is always emitted before any `engine.events` of that
// generation, and a batch buffered for generation N is always flushed (or discarded) before that
// resync, so no N-generation event can surface after the N+1 marker.

import type { ResyncReason, ServerId } from "@mortise/domain"
import type { Clock, StreamLossReason } from "./connection.js"
import type { ServiceEndpoint } from "./discovery.js"
import type { Logger } from "./logging.js"
import { basicAuthHeaders } from "./probe.js"

/** How long the stream may receive no bytes before the watchdog aborts it (FEAT-001 §BR-013, OPS-001). */
export const STREAM_IDLE_TIMEOUT_MS = 45_000

/** How long to wait for the stream to start before aborting the connect (FEAT-001 §21 OPS-005). */
export const STREAM_CONNECT_TIMEOUT_MS = 2000

/** Default fan-out batching window in milliseconds (FEAT-001 §BR-016, §21 OPS-003, answer to Q-004). */
export const EVENT_BATCH_INTERVAL_MS = 16

/** Reconnect backoff, tried in order and capped at the last value (FEAT-001 §BR-014, OPS-002). */
export const RECONNECT_BACKOFF_MS: readonly number[] = [1000, 2000, 5000, 10_000]

/**
 * One message the stream fans out to subscribers: a batch of raw wire events, or the resync marker
 * that opens a new generation (FEAT-001 §12). The `type` is the channel event name.
 */
export type EngineStreamEvent =
  | {
      readonly type: "engine.events"
      readonly serverId: ServerId
      readonly generation: number
      readonly events: readonly unknown[]
    }
  | {
      readonly type: "engine.resync"
      readonly serverId: ServerId
      readonly generation: number
      readonly reason: ResyncReason
    }

/**
 * The slice of the connection state machine the stream reports to (FEAT-001 §10). The production
 * {@link Connection} satisfies it; tests pass a recorder.
 */
export interface StreamConnectionReporter {
  /** The stream delivered `server.connected`: `connecting` or `resyncing` becomes `live`. */
  onStreamConnected(): void
  /** The stream ended, stalled or overflowed: `live` becomes `resyncing`. */
  onStreamLost(reason: StreamLossReason): void
  /** The stream returned `401`: the password may have rotated (FEAT-001 §16). */
  onUnauthorized(): void
}

/** Dependencies of {@link createEventStream}. */
export interface EventStreamDeps {
  readonly serverId: ServerId
  /** Injected so unit tests can point at a local fixture. */
  readonly fetch: typeof globalThis.fetch
  readonly logger: Logger
  readonly clock: Clock
  readonly connection: StreamConnectionReporter
  /** Milliseconds without bytes before a reconnect. Defaults to {@link STREAM_IDLE_TIMEOUT_MS}. */
  readonly idleTimeoutMs?: number
  /** Milliseconds to wait for the stream to start. Defaults to {@link STREAM_CONNECT_TIMEOUT_MS}. */
  readonly connectTimeoutMs?: number
  /** Fan-out window. Defaults to {@link EVENT_BATCH_INTERVAL_MS}. */
  readonly batchIntervalMs?: number
  /** Backoff sequence. Defaults to {@link RECONNECT_BACKOFF_MS}. */
  readonly backoffMs?: readonly number[]
}

/**
 * Opens, fans out and repairs the single upstream stream for one server (FEAT-001 §BR-011). The
 * upstream runs while a service is adopted and at least one subscriber is listening (CASE-013);
 * stopping or disposing closes it and clears every timer.
 */
export interface EventStream {
  /** Adopt an endpoint and allow the stream to run. Safe to call again after a credential refresh. */
  start(endpoint: ServiceEndpoint): void
  /** Stop the stream deliberately. Never reported as a loss. */
  stop(): void
  /** Subscribe to raw batches and resyncs. Returns an unsubscribe function. */
  subscribe(handler: (event: EngineStreamEvent) => void): () => void
  /** Current generation; incremented on every successful connect (FEAT-001 §28, answer to Q-002). */
  generation(): number
  /** Stop and release everything. */
  dispose(): void
}

type ConnectOutcome = "unauthorized" | "aborted" | "stalled" | "closed" | "error" | "invalid-first"

interface ConnectResult {
  readonly kind: ConnectOutcome
  readonly connected: boolean
}

/**
 * A complete SSE frame starts after a blank line. The engine frames end in `\n\n`; `\r\n\r\n` is
 * accepted too. Returns the frame and the remaining buffer, or `undefined` if no full frame is here.
 */
function takeFrame(buffer: string): { readonly frame: string; readonly rest: string } | undefined {
  const lf = buffer.indexOf("\n\n")
  const crlf = buffer.indexOf("\r\n\r\n")
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { frame: buffer.slice(0, crlf), rest: buffer.slice(crlf + 4) }
  }
  if (lf !== -1) return { frame: buffer.slice(0, lf), rest: buffer.slice(lf + 2) }
  return undefined
}

/** The `data` field of one SSE frame, or `undefined` for a comment-only frame. */
function frameData(frame: string): string | undefined {
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":") || !line.startsWith("data:")) continue
    const value = line.slice(5)
    data.push(value.startsWith(" ") ? value.slice(1) : value)
  }
  return data.length === 0 ? undefined : data.join("\n")
}

/** Reads `type` from a parsed event without interpreting the rest of the payload (FEAT-001 §BR-016). */
function eventType(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined
  const type = (event as { readonly type?: unknown }).type
  return typeof type === "string" ? type : undefined
}

// A stalled stream means missed events; a server close means the engine failed or dropped the
// subscriber (its queue is the only thing that closes a healthy stream, FEAT-001 §2); a network
// error ends the transport. The resync reason mirrors that distinction (FEAT-001 §BR-015).
function lossReason(outcome: ConnectOutcome): StreamLossReason {
  if (outcome === "stalled") return "stalled"
  if (outcome === "closed") return "overflow"
  return "ended"
}

function resyncReason(loss: StreamLossReason | undefined): ResyncReason {
  if (loss === "stalled") return "gap"
  if (loss === "overflow") return "overflow"
  return "reconnected"
}

/** Builds the event stream for one server. */
export function createEventStream(deps: EventStreamDeps): EventStream {
  const idleTimeoutMs = deps.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS
  const connectTimeoutMs = deps.connectTimeoutMs ?? STREAM_CONNECT_TIMEOUT_MS
  const batchIntervalMs = deps.batchIntervalMs ?? EVENT_BATCH_INTERVAL_MS
  const backoffMs = deps.backoffMs ?? RECONNECT_BACKOFF_MS
  const subscribers = new Set<(event: EngineStreamEvent) => void>()
  let endpoint: ServiceEndpoint | undefined
  let wanted = false
  let disposed = false
  let activeRun: AbortController | undefined
  let generation = 0
  let lastLoss: StreamLossReason | undefined
  let pending: { generation: number; events: unknown[] } | undefined
  let batchTimer: unknown

  function broadcast(event: EngineStreamEvent): void {
    for (const handler of [...subscribers]) handler(event)
  }

  function clearBatchTimer(): void {
    if (batchTimer === undefined) return
    deps.clock.clearTimeout(batchTimer)
    batchTimer = undefined
  }

  // Emits whatever is buffered for the generation it was collected under. Called before a loss is
  // reported, so the old batch is always ahead of the next generation's resync.
  function flush(): void {
    clearBatchTimer()
    const batch = pending
    pending = undefined
    if (batch === undefined || batch.events.length === 0) return
    broadcast({
      type: "engine.events",
      serverId: deps.serverId,
      generation: batch.generation,
      events: batch.events,
    })
  }

  function discard(): void {
    clearBatchTimer()
    pending = undefined
  }

  function buffer(event: unknown): void {
    if (pending === undefined || pending.generation !== generation) pending = { generation, events: [] }
    pending.events.push(event)
    if (batchTimer !== undefined) return
    batchTimer = deps.clock.setTimeout(() => {
      batchTimer = undefined
      flush()
    }, batchIntervalMs)
  }

  function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      const onAbort = (): void => {
        deps.clock.clearTimeout(handle)
        resolve()
      }
      const handle = deps.clock.setTimeout(() => {
        signal.removeEventListener("abort", onAbort)
        resolve()
      }, milliseconds)
      signal.addEventListener("abort", onAbort)
    })
  }

  async function connectOnce(target: ServiceEndpoint, lifecycle: AbortController): Promise<ConnectResult> {
    const request = new AbortController()
    const relayAbort = (): void => request.abort()
    lifecycle.signal.addEventListener("abort", relayAbort)
    let connected = false
    let stalled = false
    let watchdog: unknown
    // Give up if the stream never starts; a healthy engine sends `server.connected` at once (OPS-005).
    let connectTimer: unknown = deps.clock.setTimeout(() => {
      request.abort()
    }, connectTimeoutMs)
    const clearConnectTimer = (): void => {
      if (connectTimer === undefined) return
      deps.clock.clearTimeout(connectTimer)
      connectTimer = undefined
    }
    // Any received bytes — including a heartbeat comment — push the stall deadline out (BR-013).
    const touch = (): void => {
      if (watchdog !== undefined) deps.clock.clearTimeout(watchdog)
      watchdog = deps.clock.setTimeout(() => {
        stalled = true
        request.abort()
      }, idleTimeoutMs)
    }

    try {
      const response = await deps.fetch(new URL("/api/event", target.url), {
        headers: basicAuthHeaders(target),
        signal: request.signal,
      })
      if (lifecycle.signal.aborted) return { kind: "aborted", connected }
      if (response.status === 401) {
        // The password may have rotated; hand off to the connection machine (FEAT-001 §16).
        deps.connection.onUnauthorized()
        return { kind: "unauthorized", connected }
      }
      if (!response.ok || response.body === null) return { kind: "error", connected }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let text = ""
      touch()
      for (;;) {
        const chunk = await reader.read()
        if (lifecycle.signal.aborted) return { kind: "aborted", connected }
        if (chunk.done) return { kind: "closed", connected }
        touch()
        text += decoder.decode(chunk.value, { stream: true })
        for (;;) {
          const taken = takeFrame(text)
          if (taken === undefined) break
          text = taken.rest
          const data = frameData(taken.frame)
          if (data === undefined) continue
          let event: unknown
          try {
            event = JSON.parse(data)
          } catch {
            // A malformed event is skipped, never fatal, and logged without payload contents (BR-017).
            deps.logger.warn("malformed event", { serverId: deps.serverId, generation })
            continue
          }
          if (!connected) {
            const type = eventType(event)
            if (type !== "server.connected") {
              deps.logger.error("event stream did not start with server.connected", {
                serverId: deps.serverId,
                type: type ?? "unknown",
              })
              return { kind: "invalid-first", connected }
            }
            connected = true
            clearConnectTimer()
            generation += 1
            if (generation > 1) {
              const reason = resyncReason(lastLoss)
              deps.logger.info("event stream resync", { serverId: deps.serverId, generation, reason })
              broadcast({ type: "engine.resync", serverId: deps.serverId, generation, reason })
            }
            deps.logger.info("event stream connected", { serverId: deps.serverId, generation })
            deps.connection.onStreamConnected()
            continue
          }
          buffer(event)
        }
      }
    } catch {
      if (lifecycle.signal.aborted) return { kind: "aborted", connected }
      if (stalled) return { kind: "stalled", connected }
      return { kind: "error", connected }
    } finally {
      lifecycle.signal.removeEventListener("abort", relayAbort)
      clearConnectTimer()
      if (watchdog !== undefined) deps.clock.clearTimeout(watchdog)
      request.abort()
    }
  }

  function run(target: ServiceEndpoint, lifecycle: AbortController): void {
    const isActive = (): boolean => activeRun === lifecycle && !lifecycle.signal.aborted && !disposed
    void (async () => {
      let backoffIndex = 0
      while (isActive()) {
        const result = await connectOnce(target, lifecycle)
        if (!isActive() || result.kind === "aborted" || result.kind === "unauthorized") break
        // A loss is only meaningful once a generation was live; a never-connected attempt just backs
        // off. A good connect resets the backoff for the next failure (BR-014).
        if (result.connected) {
          backoffIndex = 0
          const reason = lossReason(result.kind)
          lastLoss = reason
          deps.logger.info("event stream lost", { serverId: deps.serverId, generation, reason })
          flush()
          deps.connection.onStreamLost(reason)
        }
        const index = Math.min(backoffIndex, backoffMs.length - 1)
        const delay = backoffMs[index] ?? backoffMs[backoffMs.length - 1] ?? 0
        backoffIndex += 1
        await sleep(delay, lifecycle.signal)
      }
    })()
  }

  function stopRun(): void {
    const controller = activeRun
    activeRun = undefined
    controller?.abort()
  }

  function startRun(target: ServiceEndpoint): void {
    const lifecycle = new AbortController()
    activeRun = lifecycle
    discard()
    run(target, lifecycle)
  }

  // The upstream is open only while a service is adopted and someone is listening (CASE-013).
  function update(): void {
    if (disposed || !wanted || subscribers.size === 0 || endpoint === undefined) {
      if (activeRun !== undefined) stopRun()
      return
    }
    if (activeRun === undefined) startRun(endpoint)
  }

  return {
    start(target) {
      if (disposed) return
      endpoint = target
      wanted = true
      // Restart against the possibly refreshed endpoint (a new password after a 401).
      stopRun()
      update()
    },
    stop() {
      wanted = false
      stopRun()
      discard()
    },
    subscribe(handler) {
      subscribers.add(handler)
      update()
      return () => {
        subscribers.delete(handler)
        update()
      }
    },
    generation: () => generation,
    dispose() {
      disposed = true
      wanted = false
      subscribers.clear()
      stopRun()
      discard()
    },
  }
}
