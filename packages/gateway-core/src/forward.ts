// Authenticated request forwarding (FEAT-001 §BR-019..BR-026, §SEC-003, §SEC-004). This is the
// gateway's security boundary: it re-validates every `engine.fetch` before the network is touched
// (defense in depth, the channel schema is only the first line), injects Basic auth, strips
// `set-cookie` from the response, and maps failures to channel errors. It never retries: a request
// is forwarded at most once, so a non-idempotent call cannot be replayed (§BR-026).

import { ChannelError, type MethodHandler } from "@mortise/rpc-contracts"
import type { ServiceEndpoint } from "./discovery.js"
import type { Logger } from "./logging.js"
import { basicAuthHeaders } from "./probe.js"

/** How long a forwarded request may take before it is mapped to `timeout` (FEAT-001 §OPS-004). */
export const FORWARD_TIMEOUT_MS = 30_000

/** Header names the client may never set; the gateway owns authentication (FEAT-001 §BR-020). */
const FORBIDDEN_HEADERS: ReadonlySet<string> = new Set(["authorization", "cookie", "proxy-authorization"])

/** The slice of the connection state machine forwarding reports a `401` to (FEAT-001 §BR-025). */
export interface ForwardConnectionReporter {
  /** A forwarded request returned `401`: re-read the registration and recover. */
  onUnauthorized(): void
}

/** Dependencies of {@link createForwardHandler}. */
export interface ForwardDeps {
  /** Injected so tests stay offline. */
  readonly fetch: typeof globalThis.fetch
  readonly logger: Logger
  /** The adopted endpoint, or `undefined` before a service is found. Carries the password. */
  readonly endpoint: () => ServiceEndpoint | undefined
  readonly connection: ForwardConnectionReporter
  /** Milliseconds to wait for a response. Defaults to {@link FORWARD_TIMEOUT_MS}. */
  readonly timeoutMs?: number
}

/**
 * Whether the gateway forwards this path (FEAT-001 §BR-019, §SEC-003): under `/api/`, or exactly
 * `/openapi.json`; never an absolute URL, never a traversal (plain or percent-encoded, so an
 * encoded `..` cannot decode its way out of the allowlist), never the pairing `/auth/` routes.
 */
function isAllowedPath(path: string): boolean {
  const lower = path.toLowerCase()
  if (path.includes("..")) return false
  if (lower.includes("%2e") || lower.includes("%2f")) return false
  if (lower.includes("://") || lower.startsWith("//")) return false
  if (lower.startsWith("/auth/")) return false
  return path.startsWith("/api/") || path === "/openapi.json"
}

/** The first client-supplied forbidden header name, matched case-insensitively (FEAT-001 §BR-020). */
function forbiddenHeader(headers: Readonly<Record<string, string>> | undefined): string | undefined {
  if (headers === undefined) return undefined
  for (const name of Object.keys(headers)) {
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) return name
  }
  return undefined
}

/** Response media types the caller receives as text rather than base64 (FEAT-001 §BR-022). */
function isTextMediaType(contentType: string | null): boolean {
  const media = (contentType ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? ""
  return media === "application/json" || media.startsWith("text/")
}

/** Every response header except `set-cookie`, which never reaches the caller (FEAT-001 §SEC-004). */
function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of headers) {
    if (name.toLowerCase() === "set-cookie") continue
    result[name] = value
  }
  return result
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "the engine could not be reached"
}

/**
 * Builds the `engine.fetch` handler the channel server registers (T-009). The input is validated
 * again here, then forwarded once with Basic auth; the response is classified and returned, and any
 * failure becomes a {@link ChannelError} with `forbidden_path`, `engine_unreachable` or `timeout`.
 */
export function createForwardHandler(deps: ForwardDeps): MethodHandler<"engine.fetch"> {
  const timeoutMs = deps.timeoutMs ?? FORWARD_TIMEOUT_MS

  return async (input) => {
    const { serverId, path } = input
    if (!isAllowedPath(path)) {
      deps.logger.warn("forwarding rejected: path", { serverId, path, code: "forbidden_path" })
      throw new ChannelError("forbidden_path", `path is not allowed: ${path}`)
    }
    const forbidden = forbiddenHeader(input.headers)
    if (forbidden !== undefined) {
      deps.logger.warn("forwarding rejected: header", {
        serverId,
        path,
        header: forbidden,
        code: "forbidden_path",
      })
      throw new ChannelError("forbidden_path", `header must not be set: ${forbidden}`)
    }

    const endpoint = deps.endpoint()
    if (endpoint === undefined) {
      deps.logger.warn("forwarding failed: no engine", { serverId, path, code: "engine_unreachable" })
      throw new ChannelError("engine_unreachable", "no engine is connected")
    }

    const url = new URL(path, endpoint.url)
    for (const [name, value] of Object.entries(input.query ?? {})) {
      for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(name, entry)
    }
    // The channel already rejected these headers, but the gateway owns authentication and must not
    // trust a caller that reaches the handler another way (FEAT-001 §BR-020, §SEC-003).
    const headers: Record<string, string> = { ...input.headers, ...basicAuthHeaders(endpoint) }
    const body =
      input.body === null
        ? undefined
        : input.body.kind === "text"
          ? input.body.text
          : new Uint8Array(Buffer.from(input.body.data, "base64"))

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      const response = await deps.fetch(url, { method: input.method, headers, body, signal: controller.signal })
      if (response.status === 401) {
        // The password may have rotated; hand off to the connection machine (FEAT-001 §BR-025).
        deps.logger.warn("forwarded request was unauthorized", { serverId, path, status: 401 })
        deps.connection.onUnauthorized()
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      const asText = isTextMediaType(response.headers.get("content-type"))
      return {
        status: response.status,
        headers: responseHeaders(response.headers),
        body: asText
          ? { kind: "text" as const, text: new TextDecoder().decode(bytes) }
          : { kind: "base64" as const, data: Buffer.from(bytes).toString("base64") },
      }
    } catch (cause) {
      if (timedOut) {
        deps.logger.warn("forwarding failed: timeout", { serverId, path, code: "timeout" })
        throw new ChannelError("timeout", `the engine did not answer within ${timeoutMs} ms`)
      }
      deps.logger.warn("forwarding failed: unreachable", { serverId, path, code: "engine_unreachable" })
      throw new ChannelError("engine_unreachable", errorMessage(cause))
    } finally {
      clearTimeout(timer)
    }
  }
}
