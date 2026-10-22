import { MessageChannel, type MessagePort } from "node:worker_threads"
import {
  type ConnectionChange,
  createLogger,
  type EngineStreamEvent,
  type ForwardConnectionReporter,
} from "@mortise/gateway-core"
import { type Channel, createClient, serverIdSchema, type Transport } from "@mortise/rpc-contracts"
import { afterEach, describe, expect, it } from "vitest"
import { createGatewayHost, type GatewayHost, type GatewayHostGateway, type HostWindow } from "./gateway-host.js"
import type { MainMessagePort } from "./transport.js"

const SERVER = serverIdSchema.parse("shared")
const SERVER_REF = { id: SERVER, label: "OpenCode", kind: "shared" as const, url: "http://127.0.0.1:49374" }
const LIVE_STATE: ReturnType<GatewayHostGateway["connection"]> = {
  phase: "live",
  info: {
    version: "2.0.26",
    support: "supported",
    capabilities: {
      pairing: false,
      persistentTerminals: false,
      forkBeforeMessage: false,
      experimental: new Set(),
    },
  },
}

const cleanups: Array<() => void> = []

function onCleanup(cleanup: () => void): void {
  cleanups.push(cleanup)
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** Adapts a worker-thread port to the `MessagePortMain` surface the host's transport consumes. */
function mainPort(end: MessagePort): MainMessagePort {
  const wrappers = new WeakMap<(event: { readonly data: unknown }) => void, (value: unknown) => void>()
  return {
    postMessage: (message) => end.postMessage(message),
    on: (_event, listener) => {
      const wrapper = (value: unknown) => listener({ data: value })
      wrappers.set(listener, wrapper)
      end.on("message", wrapper)
    },
    off: (_event, listener) => {
      const wrapper = wrappers.get(listener)
      if (wrapper === undefined) return
      end.off("message", wrapper)
      wrappers.delete(listener)
    },
    start: () => end.start(),
    close: () => end.close(),
  }
}

/** The client a window builds from the port it receives. */
function clientFor(end: MessagePort): Channel {
  const handlers = new Set<(message: unknown) => void>()
  end.on("message", (value) => {
    for (const handler of [...handlers]) handler(value)
  })
  end.start()
  const transport: Transport = {
    send: (message) => end.postMessage(message),
    onMessage: (handler) => {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    close: () => {
      handlers.clear()
      end.close()
    },
  }
  const client = createClient(transport)
  onCleanup(() => client.close())
  return client
}

interface FakeGateway {
  readonly gateway: GatewayHostGateway
  startCount(): number
  disposeCount(): number
  serversCalls(): number
  streamSubscriberCount(): number
  changeSubscriberCount(): number
  emitChange(change: ConnectionChange): void
}

function createFakeGateway(): FakeGateway {
  const stream = new Set<(event: EngineStreamEvent) => void>()
  const changes = new Set<(change: ConnectionChange) => void>()
  let started = 0
  let disposed = 0
  let serverCalls = 0
  const connection: ForwardConnectionReporter = { onUnauthorized: () => undefined }
  const gateway: GatewayHostGateway = {
    start() {
      started += 1
      return Promise.resolve()
    },
    servers() {
      serverCalls += 1
      return [SERVER_REF]
    },
    connection: () => LIVE_STATE,
    onConnectionChange(handler) {
      changes.add(handler)
      return () => {
        changes.delete(handler)
      }
    },
    dispose() {
      disposed += 1
      stream.clear()
      changes.clear()
    },
    internal: {
      events: {
        subscribe(handler) {
          stream.add(handler)
          return () => {
            stream.delete(handler)
          }
        },
      },
      endpoint: () => undefined,
      connection,
    },
  }
  return {
    gateway,
    startCount: () => started,
    disposeCount: () => disposed,
    serversCalls: () => serverCalls,
    streamSubscriberCount: () => stream.size,
    changeSubscriberCount: () => changes.size,
    emitChange(change) {
      for (const handler of [...changes]) handler(change)
    },
  }
}

interface FakeWindow {
  readonly window: HostWindow<MessagePort>
  load(): void
  close(): void
  readonly sent: MessagePort[]
}

function createFakeWindow(): FakeWindow {
  let loaded: (() => void) | undefined
  let closed: (() => void) | undefined
  const sent: MessagePort[] = []
  return {
    window: {
      onDidFinishLoad: (listener) => {
        loaded = listener
      },
      onClosed: (listener) => {
        closed = listener
      },
      sendChannel: (port) => {
        sent.push(port)
      },
    },
    load: () => loaded?.(),
    close: () => closed?.(),
    sent,
  }
}

interface Harness {
  readonly host: GatewayHost<MessagePort>
  readonly fake: FakeGateway
  readonly channels: Array<{ readonly main: MainMessagePort; readonly windowPort: MessagePort }>
  createCount(): number
}

function createHarness(): Harness {
  const fake = createFakeGateway()
  const channels: Harness["channels"] = []
  let created = 0
  const host = createGatewayHost<MessagePort>({
    createGateway: () => {
      created += 1
      return fake.gateway
    },
    createChannel: () => {
      const pair = new MessageChannel()
      onCleanup(() => {
        pair.port1.close()
        pair.port2.close()
      })
      const channel = { main: mainPort(pair.port1), windowPort: pair.port2 }
      channels.push(channel)
      return channel
    },
    fetch: globalThis.fetch,
    logger: createLogger({ write: () => undefined }),
  })
  onCleanup(() => host.dispose())
  return { host, fake, channels, createCount: () => created }
}

function attachWindow(harness: Harness): FakeWindow {
  const window = createFakeWindow()
  harness.host.attach(window.window)
  return window
}

function channelAt(
  harness: Harness,
  index: number,
): { readonly main: MainMessagePort; readonly windowPort: MessagePort } {
  const channel = harness.channels[index]
  if (channel === undefined) throw new Error(`channel ${index} was not created`)
  return channel
}

describe("gateway host", () => {
  it("AC-2: two windows share one gateway and each channel server holds one event subscription", async () => {
    const harness = createHarness()
    harness.host.start()
    harness.host.start()
    const first = attachWindow(harness)
    const second = attachWindow(harness)
    first.load()
    second.load()

    // One gateway for both windows, created and started exactly once.
    expect(harness.createCount()).toBe(1)
    expect(harness.fake.startCount()).toBe(1)

    // Each channel server carries one stream subscription and one connection listener.
    expect(harness.channels).toHaveLength(2)
    expect(harness.fake.streamSubscriberCount()).toBe(2)
    expect(harness.fake.changeSubscriberCount()).toBe(2)

    // Both private channels answer through the same gateway.
    const firstClient = clientFor(channelAt(harness, 0).windowPort)
    const secondClient = clientFor(channelAt(harness, 1).windowPort)
    await expect(firstClient.request("servers.list", undefined)).resolves.toEqual([SERVER_REF])
    await expect(secondClient.request("servers.list", undefined)).resolves.toEqual([SERVER_REF])
    expect(harness.fake.serversCalls()).toBe(2)

    // Closing a window releases its channel and exactly its subscriptions; the other remains.
    first.close()
    expect(harness.fake.streamSubscriberCount()).toBe(1)
    expect(harness.fake.changeSubscriberCount()).toBe(1)
    second.close()
    expect(harness.fake.streamSubscriberCount()).toBe(0)
    expect(harness.fake.changeSubscriberCount()).toBe(0)

    // Quit disposes the gateway; it never touches the engine (the fake has no engine).
    harness.host.dispose()
    expect(harness.fake.disposeCount()).toBe(1)
  })

  it("AC-2: fans a connection change out to every live window and stops at the closed one", async () => {
    const harness = createHarness()
    harness.host.start()
    const first = attachWindow(harness)
    const second = attachWindow(harness)
    first.load()
    second.load()

    const firstSeen: string[] = []
    const secondSeen: string[] = []
    clientFor(channelAt(harness, 0).windowPort).subscribe("connection.changed", ({ state }) => {
      firstSeen.push(state.phase)
    })
    clientFor(channelAt(harness, 1).windowPort).subscribe("connection.changed", ({ state }) => {
      secondSeen.push(state.phase)
    })

    harness.fake.emitChange({ serverId: SERVER, state: { phase: "connecting", url: SERVER_REF.url } })
    await waitFor(() => firstSeen.length === 1 && secondSeen.length === 1, "broadcast to both windows")
    expect(firstSeen).toEqual(["connecting"])
    expect(secondSeen).toEqual(["connecting"])

    first.close()
    harness.fake.emitChange({ serverId: SERVER, state: LIVE_STATE })
    await waitFor(() => secondSeen.length === 2, "broadcast to the remaining window")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(firstSeen).toEqual(["connecting"])
    expect(secondSeen).toEqual(["connecting", "live"])
  })

  it("AC-2: a reload replaces the window's channel without doubling its subscriptions", () => {
    const harness = createHarness()
    harness.host.start()
    const window = attachWindow(harness)
    window.load()
    expect(harness.fake.streamSubscriberCount()).toBe(1)
    const firstPort = window.sent[0]

    window.load()
    expect(harness.fake.streamSubscriberCount()).toBe(1)
    expect(window.sent).toHaveLength(2)
    expect(window.sent[1]).not.toBe(firstPort)
  })

  it("AC-2: dispose before a load creates no channel and leaves the gateway stopped", () => {
    const harness = createHarness()
    harness.host.start()
    const window = attachWindow(harness)
    harness.host.dispose()
    window.load()
    expect(harness.channels).toHaveLength(0)
    expect(harness.fake.disposeCount()).toBe(1)
  })
})
