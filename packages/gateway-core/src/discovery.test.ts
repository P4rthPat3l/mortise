import { describe, expect, it } from "vitest"
import {
  createDiscovery,
  SERVICE_COMMAND,
  type ServiceClient,
  type ServiceEndpoint,
  type ServiceOptions,
} from "./discovery.js"

const ENDPOINT: ServiceEndpoint = {
  url: "http://127.0.0.1:49374",
  auth: { type: "basic", username: "opencode", password: "pw" },
}

interface Fake {
  readonly client: ServiceClient
  readonly ensureCalls: ServiceOptions[]
  readonly discoverCalls: { count: number }
}

function fakeClient(found: ServiceEndpoint | undefined, ensureResult: ServiceEndpoint = ENDPOINT): Fake {
  const ensureCalls: ServiceOptions[] = []
  const discoverCalls = { count: 0 }
  return {
    ensureCalls,
    discoverCalls,
    client: {
      async discover() {
        discoverCalls.count += 1
        return found
      },
      async ensure(options) {
        ensureCalls.push(options ?? {})
        return ensureResult
      },
    },
  }
}

describe("discovery start policy", () => {
  it("BR-001: joins a ready registration and never calls ensure()", async () => {
    const fake = fakeClient(ENDPOINT)
    const discovery = createDiscovery({ client: fake.client, findCli: async () => true })
    const outcome = await discovery.findOrStart()
    expect(outcome).toEqual({ kind: "found", endpoint: ENDPOINT })
    expect(fake.ensureCalls).toHaveLength(0)
  })

  it("BR-002: ensure() is called with the user's CLI and no version option", async () => {
    const fake = fakeClient(undefined)
    const discovery = createDiscovery({ client: fake.client, findCli: async () => true })
    const outcome = await discovery.findOrStart()
    expect(outcome).toEqual({ kind: "started", endpoint: ENDPOINT })
    expect(fake.ensureCalls).toHaveLength(1)
    const options = fake.ensureCalls[0]
    expect(options).toBeDefined()
    expect("version" in (options ?? {})).toBe(false)
    expect(options?.command).toEqual([...SERVICE_COMMAND])
    expect(options?.command).toEqual(["opencode", "serve", "--service"])
  })

  it("BR-004: starts only when no registration exists and the CLI is found", async () => {
    const noCli = fakeClient(undefined)
    const discovery = createDiscovery({ client: noCli.client, findCli: async () => false })
    expect(await discovery.findOrStart()).toEqual({ kind: "no-engine", reason: "no-cli" })
    expect(noCli.ensureCalls).toHaveLength(0)

    const disabled = fakeClient(undefined)
    const blocked = createDiscovery({ client: disabled.client, findCli: async () => true, startAllowed: false })
    expect(await blocked.findOrStart()).toEqual({ kind: "no-engine", reason: "start-disabled" })
    expect(disabled.ensureCalls).toHaveLength(0)
  })

  it("BR-004: reports starting only on the start path, right before ensure()", async () => {
    const started = fakeClient(undefined)
    const discovery = createDiscovery({ client: started.client, findCli: async () => true })
    const order: string[] = []
    await discovery.findOrStart({ onStarting: () => order.push("starting") })
    order.push("done")
    expect(order).toEqual(["starting", "done"])

    const found = fakeClient(ENDPOINT)
    const adopted = createDiscovery({ client: found.client, findCli: async () => true })
    let called = false
    await adopted.findOrStart({ onStarting: () => (called = true) })
    expect(called).toBe(false)
  })

  it("BR-001: discover() re-reads the registration without starting anything", async () => {
    const fake = fakeClient(ENDPOINT)
    const discovery = createDiscovery({ client: fake.client, findCli: async () => true })
    expect(await discovery.discover()).toEqual(ENDPOINT)
    expect(fake.discoverCalls.count).toBe(1)
    expect(fake.ensureCalls).toHaveLength(0)
  })
})
