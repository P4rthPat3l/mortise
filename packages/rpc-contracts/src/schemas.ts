import { serverId } from "@mortise/domain"
import { z } from "zod"

/** Validates a string and brands it as a `ServerId`. Mirrors `@mortise/domain`'s `ServerId`. */
export const serverIdSchema = z.string().transform(serverId)

/** Mirrors `ServerRef` from `@mortise/domain`. */
export const serverRefSchema = z.object({
  id: serverIdSchema,
  label: z.string(),
  kind: z.enum(["shared", "isolated", "remote"]),
  url: z.string(),
})

/** Mirrors `EngineCapabilities` from `@mortise/domain`. */
export const engineCapabilitiesSchema = z.object({
  pairing: z.boolean(),
  persistentTerminals: z.boolean(),
  forkBeforeMessage: z.boolean(),
  experimental: z.set(z.string()).readonly(),
})

/** Mirrors `SupportState` from `@mortise/domain`. */
export const supportStateSchema = z.enum(["supported", "untested", "unsupported"])

/** Mirrors `EngineInfo` from `@mortise/domain`. */
export const engineInfoSchema = z.object({
  version: z.string(),
  capabilities: engineCapabilitiesSchema,
  support: supportStateSchema,
})

/** Mirrors `ConnectionState` from `@mortise/domain`, discriminated by `phase`. */
export const connectionStateSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("discovering") }),
  z.object({ phase: z.literal("starting") }),
  z.object({ phase: z.literal("no-engine") }),
  z.object({ phase: z.literal("connecting"), url: z.string() }),
  z.object({ phase: z.literal("unauthorized"), url: z.string() }),
  z.object({
    phase: z.literal("incompatible"),
    reason: z.enum(["info-missing", "version-out-of-range", "missing-capability"]),
    engineVersion: z.string().optional(),
    supportedRange: z.string(),
  }),
  z.object({ phase: z.literal("hydrating"), info: engineInfoSchema }),
  z.object({ phase: z.literal("live"), info: engineInfoSchema }),
  z.object({
    phase: z.literal("resyncing"),
    info: engineInfoSchema,
    reason: z.enum(["ended", "stalled", "overflow"]),
  }),
  z.object({ phase: z.literal("failed"), message: z.string() }),
])

/** Mirrors `ResyncReason` from `@mortise/domain`; carried by the `engine.resync` event. */
export const resyncReasonSchema = z.enum(["reconnected", "overflow", "gap"])
