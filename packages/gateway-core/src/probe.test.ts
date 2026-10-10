import { describe, expect, it } from "vitest"
import type { ServiceEndpoint } from "./discovery.js"
import { basicAuthHeaders, probeInfo, supportState } from "./probe.js"

const ENDPOINT: ServiceEndpoint = {
  url: "http://127.0.0.1:49374",
  auth: { type: "basic", username: "opencode", password: "pw" },
}

const INFO = {
  version: "2.0.26",
  pid: 4242,
  urls: ["http://127.0.0.1:49374"],
  paths: { tmp: "/tmp/opencode" },
  capabilities: { persistentPty: true },
}

interface Capture {
  readonly fetch: typeof globalThis.fetch
  readonly requests: Array<{ url: string; headers: unknown }>
}

function respond(handler: (url: string) => Response): Capture {
  const requests: Capture["requests"] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url
    requests.push({ url, headers: init?.headers })
    return handler(url)
  }
  return { fetch, requests }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("probe /api/info", () => {
  it("BR-006: parses a healthy body and ignores unknown fields", async () => {
    const capture = respond(() => json({ ...INFO, extra: "ignored" }))
    const result = await probeInfo({ fetch: capture.fetch }, ENDPOINT)
    expect(result).toEqual({
      kind: "ok",
      info: {
        version: "2.0.26",
        pid: 4242,
        urls: ["http://127.0.0.1:49374"],
        paths: { tmp: "/tmp/opencode" },
        capabilities: { persistentPty: true },
      },
    })
  })

  it("BR-008: a 404 means an incompatible protocol, not an older version", async () => {
    const capture = respond(() => new Response("not found", { status: 404 }))
    expect(await probeInfo({ fetch: capture.fetch }, ENDPOINT)).toEqual({ kind: "info-missing" })
  })

  it("AC-004: a 401 is reported as unauthorized", async () => {
    const capture = respond(() => new Response("unauthorized", { status: 401 }))
    expect(await probeInfo({ fetch: capture.fetch }, ENDPOINT)).toEqual({ kind: "unauthorized" })
  })

  it("reports a network failure as unreachable", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED")
    }
    expect(await probeInfo({ fetch }, ENDPOINT)).toEqual({ kind: "unreachable", message: "ECONNREFUSED" })
  })

  it("reports a non-2xx, non-401/404 status as an error", async () => {
    const capture = respond(() => new Response("boom", { status: 500 }))
    expect(await probeInfo({ fetch: capture.fetch }, ENDPOINT)).toEqual({ kind: "error", status: 500 })
  })

  it("reports a 200 with a non-conforming body as an error", async () => {
    const capture = respond(() => json({ pid: 1 }))
    expect(await probeInfo({ fetch: capture.fetch }, ENDPOINT)).toEqual({ kind: "error", status: 200 })
  })

  it("SEC-001: sends Basic auth with username opencode", async () => {
    const capture = respond(() => json(INFO))
    await probeInfo({ fetch: capture.fetch }, ENDPOINT)
    expect(capture.requests[0]?.url).toBe("http://127.0.0.1:49374/api/info")
    const headers = capture.requests[0]?.headers as Record<string, string> | undefined
    expect(headers?.["authorization"]).toBe(`Basic ${Buffer.from("opencode:pw").toString("base64")}`)
  })
})

describe("basicAuthHeaders", () => {
  it("encodes username and password, and is absent when the endpoint needs no auth", () => {
    expect(basicAuthHeaders(ENDPOINT)).toEqual({
      authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}`,
    })
    expect(basicAuthHeaders({ url: "http://x" })).toBeUndefined()
  })
})

describe("support state", () => {
  it("BR-006: classifies the declared range, newer 2.0.x, the next minor and unparseable versions", () => {
    expect(supportState("2.0.19")).toBe("unsupported")
    expect(supportState("2.0.20")).toBe("supported")
    expect(supportState("2.0.26")).toBe("supported")
    expect(supportState("2.0.27")).toBe("untested")
    expect(supportState("2.0.99")).toBe("untested")
    expect(supportState("2.1.0")).toBe("unsupported")
    expect(supportState("3.0.0")).toBe("unsupported")
    expect(supportState("not-a-version")).toBe("unsupported")
  })
})
