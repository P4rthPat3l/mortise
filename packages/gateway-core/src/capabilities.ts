// Capability derivation from `/api/info` and `/openapi.json` (FEAT-001 §BR-009, §13.2). The
// derived set is cached per engine version, so a reconnect does not refetch the schema and two
// engines of one version share an answer.

import type { EngineCapabilities } from "@mortise/domain"
import { z } from "zod"
import type { ServiceEndpoint } from "./discovery.js"
import { basicAuthHeaders, type ServerInfo } from "./probe.js"

/** The `/openapi.json` shape the gateway reads. Everything else is ignored. */
const openApiSchema = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
})

interface Operation {
  readonly path: string
  readonly operationId: string
  readonly definition: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function collectOperations(document: z.infer<typeof openApiSchema>): Operation[] {
  const operations: Operation[] = []
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const definition of Object.values(methods)) {
      if (!isRecord(definition)) continue
      const operationId = definition["operationId"]
      if (typeof operationId === "string") operations.push({ path, operationId, definition })
    }
  }
  return operations
}

function requestBodyFields(definition: unknown): ReadonlySet<string> {
  const fields = new Set<string>()
  if (!isRecord(definition) || !isRecord(definition["requestBody"])) return fields
  const content = definition["requestBody"]["content"]
  if (!isRecord(content)) return fields
  for (const media of Object.values(content)) {
    if (!isRecord(media) || !isRecord(media["schema"])) continue
    const properties = media["schema"]["properties"]
    if (!isRecord(properties)) continue
    for (const name of Object.keys(properties)) fields.add(name)
  }
  return fields
}

/**
 * Derives {@link EngineCapabilities} from the parsed `/api/info` body and an `/openapi.json`
 * document. Missing data fails safe: an absent operation, field or capability flag turns off the
 * corresponding flag, never on (§13.4).
 */
export function deriveCapabilities(info: ServerInfo, openapi: unknown): EngineCapabilities {
  const parsed = openApiSchema.safeParse(openapi)
  const operations = parsed.success ? collectOperations(parsed.data) : []
  const byId = new Map(operations.map((operation) => [operation.operationId, operation]))
  const fork = byId.get("session.fork")
  return {
    pairing: byId.has("server.pair"),
    persistentTerminals: info.capabilities?.persistentPty === true,
    forkBeforeMessage: fork !== undefined && requestBodyFields(fork.definition).has("before"),
    experimental: new Set(
      operations
        .filter((operation) => operation.path.startsWith("/api/experimental"))
        .map((operation) => operation.operationId),
    ),
  }
}

/** Dependencies of {@link createCapabilityCache}. */
export interface CapabilityDeps {
  /** Injected so tests stay offline. */
  readonly fetch: typeof globalThis.fetch
}

/** Derives and caches capabilities per engine version (FEAT-001 §BR-009). */
export interface CapabilityCache {
  forVersion(version: string, info: ServerInfo, endpoint: ServiceEndpoint): Promise<EngineCapabilities>
}

async function fetchOpenApi(deps: CapabilityDeps, endpoint: ServiceEndpoint): Promise<unknown | undefined> {
  try {
    const response = await deps.fetch(new URL("/openapi.json", endpoint.url), {
      headers: basicAuthHeaders(endpoint),
    })
    if (!response.ok) return undefined
    return await response.json().catch(() => undefined)
  } catch {
    return undefined
  }
}

/**
 * Builds a per-version cache. A failed `/openapi.json` read returns a degraded but safe set and is
 * not cached, so a later successful read still wins (§13.4).
 */
export function createCapabilityCache(deps: CapabilityDeps): CapabilityCache {
  const cache = new Map<string, EngineCapabilities>()
  return {
    async forVersion(version, info, endpoint) {
      const cached = cache.get(version)
      if (cached !== undefined) return cached
      const openapi = await fetchOpenApi(deps, endpoint)
      const capabilities = deriveCapabilities(info, openapi)
      if (openapi !== undefined) cache.set(version, capabilities)
      return capabilities
    },
  }
}
