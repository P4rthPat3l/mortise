import { z } from "zod"
import { connectionStateSchema, resyncReasonSchema, serverIdSchema } from "./schemas.js"

/** A connection state transition for one server (FEAT-001 §12). */
export const connectionChangedEventSchema = z.object({
  serverId: serverIdSchema,
  state: connectionStateSchema,
})

/**
 * Raw wire events from one engine stream, tagged with the generation they belong to. The payloads
 * stay `unknown`; only the adapter (`@mortise/engine-opencode`) interprets them (FEAT-001 §BR-016).
 */
export const engineEventsEventSchema = z.object({
  serverId: serverIdSchema,
  generation: z.number().int(),
  events: z.array(z.unknown()),
})

/** Marks a new stream generation; views must rebuild from fresh reads (FEAT-001 §BR-015). */
export const engineResyncEventSchema = z.object({
  serverId: serverIdSchema,
  generation: z.number().int(),
  reason: resyncReasonSchema,
})

/** Every event the gateway emits, keyed by name. */
export const events = {
  "connection.changed": connectionChangedEventSchema,
  "engine.events": engineEventsEventSchema,
  "engine.resync": engineResyncEventSchema,
} as const

/** A gateway event name. */
export type EventName = keyof typeof events

/** Validated payload type of event `E`, inferred from its schema. */
export type EventPayload<E extends EventName> = z.infer<(typeof events)[E]>
