// The `/api/info` probe and the version support policy (FEAT-001 §BR-006, §BR-008, §13.2).
// A 404 is an incompatible protocol, not an older version. The comparison is local: no new
// dependency, and the declared range is data this package owns (FEAT-001 §22).

import type { SupportState } from "@mortise/domain"
import { z } from "zod"
import type { ServiceEndpoint } from "./discovery.js"

/** Lowest engine version Mortise supports (FEAT-001 §BR-006, §13.3). */
export const FLOOR_VERSION = "2.0.20"

/** First version outside the supported range (FEAT-001 §BR-006). */
export const CEILING_VERSION = "2.1.0"

/** Newest engine version Mortise has been tested against (FEAT-001 §22). */
export const HIGHEST_TESTED_VERSION = "2.0.26"

/** Human-readable declared support range, shown in the `incompatible` state. */
export const SUPPORTED_RANGE = `>=${FLOOR_VERSION} <${CEILING_VERSION}`

/**
 * The `/api/info` body. Lenient by design (§13.4): only the fields the gateway uses are required,
 * and unknown fields are ignored. `capabilities` is optional at every level so older engines decode.
 */
export const serverInfoSchema = z.object({
  version: z.string(),
  pid: z.number().int().nonnegative(),
  urls: z.array(z.string()).optional(),
  paths: z.record(z.string(), z.string()).optional(),
  capabilities: z
    .object({
      persistentPty: z.boolean().optional(),
    })
    .optional(),
})

/** The parsed `/api/info` body. */
export type ServerInfo = z.infer<typeof serverInfoSchema>

/** What a probe of `/api/info` learned. */
export type ProbeResult =
  | { readonly kind: "ok"; readonly info: ServerInfo }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "info-missing" }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "error"; readonly status: number }

/** Dependencies of {@link probeInfo}. */
export interface ProbeDeps {
  /** Injected so tests stay offline. */
  readonly fetch: typeof globalThis.fetch
}

/** Basic auth headers for the service, or `undefined` when it needs none. */
export function basicAuthHeaders(endpoint: ServiceEndpoint): Record<string, string> | undefined {
  const auth = endpoint.auth
  if (auth === undefined) return undefined
  return { authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}` }
}

type ParsedVersion = readonly [number, number, number]

/** Parses `major.minor.patch`, ignoring a pre-release or build suffix. */
function parseVersion(version: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compare(left: ParsedVersion, right: ParsedVersion): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

/**
 * Classifies a version against the declared range (FEAT-001 §BR-006): `supported` from 2.0.20 to
 * the highest tested version, `untested` for a newer 2.0.x, `unsupported` below the floor or at or
 * above 2.1.0. An unparseable version is `unsupported`.
 */
export function supportState(version: string): SupportState {
  const parsed = parseVersion(version)
  if (parsed === undefined) return "unsupported"
  const floor = parseVersion(FLOOR_VERSION)
  const ceiling = parseVersion(CEILING_VERSION)
  const highestTested = parseVersion(HIGHEST_TESTED_VERSION)
  if (floor === undefined || ceiling === undefined || highestTested === undefined) return "unsupported"
  if (compare(parsed, floor) < 0) return "unsupported"
  if (compare(parsed, ceiling) >= 0) return "unsupported"
  if (compare(parsed, highestTested) <= 0) return "supported"
  return "untested"
}

/**
 * Probes `GET /api/info` with Basic auth. A 404 means the protocol is incompatible rather than the
 * engine being older (§BR-008); a network failure is reported as `unreachable`.
 */
export async function probeInfo(deps: ProbeDeps, endpoint: ServiceEndpoint): Promise<ProbeResult> {
  let response: Response
  try {
    response = await deps.fetch(new URL("/api/info", endpoint.url), {
      headers: basicAuthHeaders(endpoint),
    })
  } catch (cause) {
    return { kind: "unreachable", message: cause instanceof Error ? cause.message : String(cause) }
  }
  if (response.status === 401) return { kind: "unauthorized" }
  if (response.status === 404) return { kind: "info-missing" }
  if (!response.ok) return { kind: "error", status: response.status }
  const body: unknown = await response.json().catch(() => undefined)
  const parsed = serverInfoSchema.safeParse(body)
  if (!parsed.success) return { kind: "error", status: response.status }
  return { kind: "ok", info: parsed.data }
}
