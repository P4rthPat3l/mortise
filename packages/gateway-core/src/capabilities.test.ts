import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createCapabilityCache, deriveCapabilities } from "./capabilities.js"
import type { ServiceEndpoint } from "./discovery.js"
import { type ServerInfo, serverInfoSchema } from "./probe.js"

const FIXTURES = new URL("../../engine-opencode/fixtures/", import.meta.url)

const fixture = (version: string, name: string): unknown =>
  JSON.parse(readFileSync(new URL(`${version}/${name}`, FIXTURES), "utf8"))

const info = (version: string): ServerInfo => serverInfoSchema.parse(fixture(version, "info.json"))
const openapi = (version: string): unknown => fixture(version, "openapi.json")

const ENDPOINT: ServiceEndpoint = {
  url: "http://127.0.0.1:49374",
  auth: { type: "basic", username: "opencode", password: "pw" },
}

describe("capability derivation", () => {
  it("BR-009: derives pairing, fork, terminals and experimental operations from a real schema", () => {
    const capabilities = deriveCapabilities(info("2.0.26"), openapi("2.0.26"))
    expect(capabilities.pairing).toBe(true)
    expect(capabilities.forkBeforeMessage).toBe(true)
    expect(capabilities.persistentTerminals).toBe(true)
    expect(capabilities.experimental.has("experimental.config.update")).toBe(true)
    expect(capabilities.experimental.size).toBeGreaterThan(0)
  })

  it("BR-009: fails safe when the schema or capability flags are missing", () => {
    const withoutCapabilities = deriveCapabilities(info("2.0.20"), openapi("2.0.20"))
    expect(withoutCapabilities.persistentTerminals).toBe(false)

    const withoutSchema = deriveCapabilities(info("2.0.26"), undefined)
    expect(withoutSchema).toEqual({
      pairing: false,
      persistentTerminals: true,
      forkBeforeMessage: false,
      experimental: new Set<string>(),
    })
  })
})

describe("capability cache", () => {
  it("BR-009: caches a version after one successful schema read", async () => {
    let requests = 0
    const fetch: typeof globalThis.fetch = async () => {
      requests += 1
      return new Response(JSON.stringify(openapi("2.0.26")), { status: 200 })
    }
    const cache = createCapabilityCache({ fetch })
    const first = await cache.forVersion("2.0.26", info("2.0.26"), ENDPOINT)
    const second = await cache.forVersion("2.0.26", info("2.0.26"), ENDPOINT)
    expect(requests).toBe(1)
    expect(second).toEqual(first)

    await cache.forVersion("2.0.20", info("2.0.20"), ENDPOINT)
    expect(requests).toBe(2)
  })

  it("BR-009: a failed schema read degrades safely and is not cached", async () => {
    let requests = 0
    const fetch: typeof globalThis.fetch = async () => {
      requests += 1
      return new Response("nope", { status: 500 })
    }
    const cache = createCapabilityCache({ fetch })
    const degraded = await cache.forVersion("2.0.26", info("2.0.26"), ENDPOINT)
    expect(degraded.pairing).toBe(false)
    expect(degraded.experimental.size).toBe(0)
    await cache.forVersion("2.0.26", info("2.0.26"), ENDPOINT)
    expect(requests).toBe(2)
  })
})
