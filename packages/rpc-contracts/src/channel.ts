import { z } from "zod"
import { type ChannelErrorCode, type Envelope, envelopeSchema } from "./envelope.js"
import { type EventName, type EventPayload, events } from "./events.js"
import { type MethodInput, type MethodName, type MethodOutput, methods } from "./methods.js"

/** Default `request` timeout in milliseconds (FEAT-001 §OPS-004). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * A failure reported by the channel. `code` is one of the envelope error codes, so callers can
 * distinguish an invalid input from a timeout or an abort.
 */
export class ChannelError extends Error {
  readonly code: ChannelErrorCode

  constructor(code: ChannelErrorCode, message: string) {
    super(message)
    this.name = "ChannelError"
    this.code = code
  }
}

/**
 * The transport a {@link Channel} runs over: MessagePort on desktop, WebSocket on web later.
 * `onMessage` returns an unsubscribe function; `close` tears the transport down.
 */
export interface Transport {
  send(message: unknown): void
  onMessage(handler: (message: unknown) => void): () => void
  close(): void
}

/**
 * The subset of `AbortSignal` the channel needs, declared structurally so this package stays
 * free of the DOM and Node libs. A real `AbortSignal` satisfies it.
 */
export interface AbortSignalLike {
  readonly aborted: boolean
  addEventListener(type: "abort", listener: () => void): void
  removeEventListener(type: "abort", listener: () => void): void
}

/** Options for a single `request`: cancellation and a per-call timeout. */
export interface RequestOptions {
  signal?: AbortSignalLike
  timeoutMs?: number
}

/** The client side of a channel: typed requests out, typed events in. */
export interface Channel {
  request<N extends MethodName>(name: N, input: MethodInput<N>, options?: RequestOptions): Promise<MethodOutput<N>>
  subscribe<E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): () => void
  close(): void
}

/** Answers one method. Receives the validated input and returns the validated output. */
export type MethodHandler<N extends MethodName> = (input: MethodInput<N>) => MethodOutput<N> | Promise<MethodOutput<N>>

/** Handlers the server registers, one per method it supports. */
export type MethodHandlers = { [N in MethodName]: MethodHandler<N> }

/** The server side of a channel: typed requests in, typed events out. */
export interface ChannelServer {
  emit<E extends EventName>(event: E, payload: EventPayload<E>): void
  close(): void
}

// setTimeout and clearTimeout are web-platform globals in every runtime Mortise targets (Electron
// renderer, Node main, browsers). They are declared here because this package compiles without the
// DOM or Node lib; the handle stays `unknown` because the two runtimes return different types.
declare const setTimeout: (handler: () => void, timeout?: number) => unknown
declare const clearTimeout: (handle: unknown) => void

const isMethodName = (name: string): name is MethodName => Object.hasOwn(methods, name)

const isEventName = (name: string): name is EventName => Object.hasOwn(events, name)

interface Pending {
  readonly name: MethodName
  resolve(value: unknown): void
  reject(error: ChannelError): void
}

/**
 * Creates the client end of a channel over `transport`. Every request input and every inbound
 * message is validated; failures reject with a {@link ChannelError} carrying the envelope code.
 */
export function createClient(transport: Transport): Channel {
  let closed = false
  let nextId = 0
  const pending = new Map<string, Pending>()
  const subscribers = new Map<EventName, Set<(payload: unknown) => void>>()

  const unsubscribe = transport.onMessage((message) => {
    const parsed = envelopeSchema.safeParse(message)
    if (!parsed.success) {
      // A malformed message cannot be routed reliably; an id is enough to fail the request waiting on it.
      const idOnly = z.object({ id: z.string() }).safeParse(message)
      if (idOnly.success) {
        pending
          .get(idOnly.data.id)
          ?.reject(new ChannelError("invalid_message", "message did not match the envelope schema"))
      }
      return
    }

    const envelope = parsed.data
    if (envelope.type === "response") {
      const entry = pending.get(envelope.id)
      if (!entry) return
      if (envelope.error) {
        entry.reject(new ChannelError(envelope.error.code, envelope.error.message))
        return
      }
      const result = methods[entry.name].output.safeParse(envelope.payload)
      if (!result.success) {
        entry.reject(new ChannelError("invalid_output", "response payload did not match the method output schema"))
        return
      }
      entry.resolve(result.data)
      return
    }

    if (envelope.type !== "event" || !isEventName(envelope.name)) return
    const result = events[envelope.name].safeParse(envelope.payload)
    if (!result.success) return
    const handlers = subscribers.get(envelope.name)
    if (!handlers) return
    for (const handler of [...handlers]) handler(result.data)
  })

  const request = <N extends MethodName>(
    name: N,
    input: MethodInput<N>,
    options?: RequestOptions,
  ): Promise<MethodOutput<N>> =>
    new Promise<MethodOutput<N>>((resolve, reject) => {
      if (closed) {
        reject(new ChannelError("aborted", "channel is closed"))
        return
      }

      const parsedInput = methods[name].input.safeParse(input)
      if (!parsedInput.success) {
        reject(new ChannelError("invalid_input", "request input did not match the method input schema"))
        return
      }

      const signal = options?.signal
      if (signal?.aborted) {
        reject(new ChannelError("aborted", "request aborted"))
        return
      }

      const id = `req_${++nextId}`
      const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
      let settled = false
      let timer: unknown

      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        signal?.removeEventListener("abort", onAbort)
        pending.delete(id)
      }
      const settleReject = (error: ChannelError) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const settleResolve = (value: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value as MethodOutput<N>)
      }
      const onAbort = () => settleReject(new ChannelError("aborted", "request aborted"))

      timer = setTimeout(
        () => settleReject(new ChannelError("timeout", `request timed out after ${timeoutMs} ms`)),
        timeoutMs,
      )
      signal?.addEventListener("abort", onAbort)
      pending.set(id, { name, resolve: settleResolve, reject: settleReject })

      const envelope: Envelope = { v: 1, id, type: "request", name, payload: parsedInput.data }
      transport.send(envelope)
    })

  const subscribe = <E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): (() => void) => {
    let handlers = subscribers.get(event)
    if (!handlers) {
      handlers = new Set()
      subscribers.set(event, handlers)
    }
    // Inbound dispatch already validated the payload with this event's schema; the cast restores
    // the subscriber's own event type.
    const wrapper = (payload: unknown) => handler(payload as EventPayload<E>)
    handlers.add(wrapper)
    return () => {
      handlers.delete(wrapper)
      if (handlers.size === 0) subscribers.delete(event)
    }
  }

  const close = () => {
    if (closed) return
    closed = true
    unsubscribe()
    const entries = [...pending.values()]
    pending.clear()
    for (const entry of entries) entry.reject(new ChannelError("aborted", "channel is closed"))
    subscribers.clear()
    transport.close()
  }

  return { request, subscribe, close }
}

/**
 * Creates the server end of a channel over `transport`. A registered handler answers its method;
 * `emit` validates and sends an event. A request with no handler is answered with
 * `method_not_found`.
 */
export function createServer(transport: Transport, handlers: Partial<MethodHandlers>): ChannelServer {
  let closed = false
  let nextId = 0

  const reply = (id: string, name: string, content: Pick<Envelope, "payload" | "error">) => {
    if (closed) return
    transport.send({ v: 1, id, type: "response", name, ...content })
  }

  const runHandler = async (id: string, name: MethodName, payload: unknown): Promise<void> => {
    // The handler was registered under `name`, so it accepts the input its schema validates.
    // TypeScript cannot carry that correlation through a runtime key, so the handler is widened.
    const handler = handlers[name] as ((input: unknown) => unknown) | undefined
    if (!handler) {
      reply(id, name, { error: { code: "method_not_found", message: `no handler for method ${name}` } })
      return
    }
    const input = methods[name].input.safeParse(payload)
    if (!input.success) {
      reply(id, name, {
        error: { code: "invalid_input", message: "request input did not match the method input schema" },
      })
      return
    }
    try {
      const output = await handler(input.data)
      const parsedOutput = methods[name].output.safeParse(output)
      if (!parsedOutput.success) {
        reply(id, name, {
          error: { code: "invalid_output", message: "handler output did not match the method output schema" },
        })
        return
      }
      reply(id, name, { payload: parsedOutput.data })
    } catch {
      reply(id, name, { error: { code: "internal", message: "handler failed" } })
    }
  }

  const unsubscribe = transport.onMessage((message) => {
    if (closed) return
    const parsed = envelopeSchema.safeParse(message)
    if (!parsed.success) {
      const idOnly = z.object({ id: z.string() }).safeParse(message)
      if (idOnly.success) {
        reply(idOnly.data.id, "", {
          error: { code: "invalid_message", message: "message did not match the envelope schema" },
        })
      }
      return
    }

    const envelope = parsed.data
    if (envelope.type !== "request") return
    if (!isMethodName(envelope.name)) {
      reply(envelope.id, envelope.name, {
        error: { code: "method_not_found", message: `unknown method ${envelope.name}` },
      })
      return
    }
    void runHandler(envelope.id, envelope.name, envelope.payload)
  })

  const emit = <E extends EventName>(event: E, payload: EventPayload<E>): void => {
    const parsed = events[event].safeParse(payload)
    if (!parsed.success) {
      throw new ChannelError("invalid_output", `payload did not match the ${event} event schema`)
    }
    if (closed) return
    const envelope: Envelope = { v: 1, id: `evt_${++nextId}`, type: "event", name: event, payload: parsed.data }
    transport.send(envelope)
  }

  const close = () => {
    if (closed) return
    closed = true
    unsubscribe()
    transport.close()
  }

  return { emit, close }
}
