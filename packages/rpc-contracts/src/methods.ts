import { z } from "zod"
import { connectionStateSchema, serverIdSchema, serverRefSchema } from "./schemas.js"

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

/** Header names the client may never set; the gateway owns authentication (FEAT-001 §BR-020). */
const FORBIDDEN_HEADERS = ["authorization", "cookie", "proxy-authorization"]

/** A request body or response body: no body, UTF-8 text, or binary as base64. */
export const engineBodySchema = z.union([
  z.null(),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("base64"), data: z.string() }),
])

/**
 * Case-insensitive rejection of `authorization`, `cookie` and `proxy-authorization`. The gateway
 * re-validates this on its own side (FEAT-001 §SEC-003); the channel is the first line.
 */
export const engineFetchHeadersSchema = z
  .record(z.string(), z.string())
  .refine((headers) => Object.keys(headers).every((name) => !FORBIDDEN_HEADERS.includes(name.toLowerCase())), {
    message: "authorization, cookie and proxy-authorization headers are not allowed",
  })

/** A path the gateway will forward: under `/api/` or exactly `/openapi.json`, and never traversing. */
export const engineFetchPathSchema = z
  .string()
  .refine((path) => path.startsWith("/api/") || path === "/openapi.json", {
    message: "path must start with /api/ or equal /openapi.json",
  })
  .refine((path) => !path.includes(".."), { message: "path must not contain .." })

/** Input of the `engine.fetch` request (FEAT-001 §12). */
export const engineFetchInputSchema = z.object({
  serverId: serverIdSchema,
  method: z.enum(HTTP_METHODS),
  path: engineFetchPathSchema,
  query: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  headers: engineFetchHeadersSchema.optional(),
  body: engineBodySchema,
})

/** Output of the `engine.fetch` request. */
export const engineFetchResponseSchema = z.object({
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
  body: engineBodySchema,
})

/**
 * Every gateway method: a request input schema and a response output schema. The channel and the
 * gateway both validate against these, so a method is added in exactly one place.
 */
export const methods = {
  "servers.list": {
    input: z.void(),
    output: z.array(serverRefSchema),
  },
  "connection.get": {
    input: z.object({ serverId: serverIdSchema }),
    output: connectionStateSchema,
  },
  "engine.fetch": {
    input: engineFetchInputSchema,
    output: engineFetchResponseSchema,
  },
} as const

/** A gateway method name. */
export type MethodName = keyof typeof methods

/** Validated input type of method `N`, inferred from its schema. */
export type MethodInput<N extends MethodName> = z.infer<(typeof methods)[N]["input"]>

/** Validated output type of method `N`, inferred from its schema. */
export type MethodOutput<N extends MethodName> = z.infer<(typeof methods)[N]["output"]>
