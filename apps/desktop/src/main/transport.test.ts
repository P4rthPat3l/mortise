import { MessageChannel, type MessagePort } from "node:worker_threads"
import { createClient, createServer, serverIdSchema, type Transport } from "@mortise/rpc-contracts"
import { afterEach, describe, expect, it } from "vitest"
import { type MainMessagePort, mainTransport } from "./transport.js"

const SERVER = { id: serverIdSchema.parse("shared"), label: "OpenCode", kind: "shared" as const, url: "" }

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

/** Adapts a worker-thread port to the `MessagePortMain` surface the main transport consumes. */
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

function pair(): { left: Transport; right: Transport } {
  const channel = new MessageChannel()
  onCleanup(() => {
    channel.port1.close()
    channel.port2.close()
  })
  return { left: mainTransport(mainPort(channel.port1)), right: mainTransport(mainPort(channel.port2)) }
}

describe("main transport", () => {
  it("AC-1: carries structured messages and stops delivering after unsubscribe", async () => {
    const { left, right } = pair()
    const received: unknown[] = []
    const unsubscribe = left.onMessage((message) => received.push(message))

    right.send({ v: 1, id: "msg_1", type: "event", name: "engine.events", payload: { events: [1, 2] } })
    await waitFor(() => received.length === 1, "first message")
    expect(received[0]).toEqual({
      v: 1,
      id: "msg_1",
      type: "event",
      name: "engine.events",
      payload: { events: [1, 2] },
    })

    unsubscribe()
    right.send({ ignored: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(received).toHaveLength(1)
  })

  it("AC-1: runs the channel client and server over a worker-thread MessageChannel", async () => {
    const { left, right } = pair()
    const server = createServer(right, { "servers.list": () => [SERVER] })
    const client = createClient(left)
    onCleanup(() => {
      client.close()
      server.close()
    })

    await expect(client.request("servers.list", undefined)).resolves.toEqual([SERVER])
  })

  it("AC-1: close stops sends and releases the listener", async () => {
    const { left, right } = pair()
    const received: unknown[] = []
    left.onMessage((message) => received.push(message))
    left.close()
    left.send({ after: "close" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(received).toHaveLength(0)
    right.close()
  })
})
